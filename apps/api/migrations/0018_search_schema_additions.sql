-- =====================================================================================
-- 0018_search_schema_additions.sql — EP-06 (DTJ-181)
-- =====================================================================================
-- Обоснованные дополнения к базовой схеме (`11-database-schema.md`), введённые модульным
-- документом поиска `docs/spec/20-module-catalog-search.md` §14 — НЕ переопределяют
-- существующие таблицы/поля, только добавляют то, чего требует формула ранжирования
-- (§3) и автодополнение (§5), но чего нет в базовой схеме.
--
-- Расширения PostgreSQL (`pg_trgm`, `unaccent`) уже включены миграцией `0001_extensions.sql`
-- (EP-01, DTJ-012) — НЕ дублируются здесь.
-- =====================================================================================

-- === 1. pharmacy_reliability_scores (SRS-CAT-066) ===
-- Read-модель операционной надёжности аптеки — единственный входной сигнал
-- `reliabilityScore` формулы ранжирования поиска (§3.1, SRS-CAT-018). Заполняется
-- ежесуточной джобой `RecomputePharmacyReliabilityJob` (контекст `analytics`, EP-17,
-- волна 11) — эта джоба НЕ входит в этот тикет и не будет существовать до гораздо более
-- поздней волны. До её появления таблица пуста весь R1 — ОЖИДАЕМОЕ состояние
-- (`SRS-CAT-067`, `TC-CAT-028`): `PostgresSearchProvider` (DTJ-185) обязан читать эту
-- таблицу через `LEFT JOIN` + `COALESCE(prs.score, 3.5)`, дефолт `3.50` ниже — то же
-- нейтральное значение.
CREATE TABLE IF NOT EXISTS pharmacy_reliability_scores (
    pharmacy_id UUID PRIMARY KEY REFERENCES pharmacies(id) ON DELETE CASCADE,
    score NUMERIC(3, 2) NOT NULL DEFAULT 3.50,  -- 0.00..5.00, дефолт для новой/безданных аптеки
    orders_considered INT NOT NULL DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_reliability_score_range CHECK (score BETWEEN 0 AND 5)
);
COMMENT ON TABLE pharmacy_reliability_scores IS
    'Read-модель (analytics/catalog), НЕ доменный агрегат PharmacyAccount. Пересчитывается '
    'ежесуточной джобой RecomputePharmacyReliabilityJob из orders/order_status. Используется '
    'ИСКЛЮЧИТЕЛЬНО как входной сигнал формулы ранжирования поиска (SRS-CAT-018), не отображается '
    'пользователю как публичный "рейтинг" (нет UI-виджета звёзд — во избежание ложного впечатления '
    'отзывов, которых нет, REQ-UX/Charter i18n не описывают такой виджет).';

-- === 2. search_query_log (SRS-CAT-069) ===
-- Журнал поисковых запросов: (а) trending searches при пустом вводе (§5, SRS-CAT-030),
-- (б) воронка продуктовой аналитики R1-15 (показ экономии -> клик на аналог -> корзина ->
-- заказ). Пишет `SearchMedicinesUseCase` (DTJ-188, тот же эпик) на каждый вызов поиска.
CREATE TABLE IF NOT EXISTS search_query_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL для гостя
    query_text VARCHAR(255) NOT NULL,
    results_count INT NOT NULL,
    clicked_medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL, -- заполняется отдельным событием клика, nullable
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_search_query_log_trending ON search_query_log (tenant_id, created_at DESC);
-- ^ Обслуживает (а) trending-выборку `WHERE tenant_id = ? ORDER BY created_at DESC LIMIT N`
--   (§5, SRS-CAT-030) и (б) диапазонное сканирование `PruneSearchQueryLogJob`
--   (`apps/worker/src/jobs/prune-search-query-log`) по `created_at < cutoff`.
COMMENT ON TABLE search_query_log IS
    'Источник для (а) trending searches при пустом вводе (§5, SRS-CAT-030), (б) воронки R1-15 '
    '(показ экономии -> клик на аналог -> корзина -> заказ) — analytics читает эту таблицу и '
    'search_query_log JOIN order_items по clicked_medicine_id для расчёта конверсии.';

-- === 3. ix_medicines_trade_name_prefix (SRS-CAT-068, SRS-DB-019) ===
-- Партиальный B-tree с `text_pattern_ops` — единственный индекс, эффективный для LIKE-
-- префиксного поиска ветки автодополнения `length(q) < 3` (GIN trgm из `pg_trgm`
-- неэффективен для запросов короче 3 символов, SRS-DB-019 уже утверждает это правило,
-- см. §5 `20-module-catalog-search.md`). `WHERE is_published = true` — автодополнение
-- никогда не должно предлагать неопубликованный медикамент (SRS-CAT-055); ЭТОТ индекс НЕ
-- используется планировщиком для запросов без такого же условия в `WHERE` — см. AC2
-- тикета DTJ-181 (частичный индекс, ожидаемое поведение, не дефект).
CREATE INDEX IF NOT EXISTS ix_medicines_trade_name_prefix
    ON medicines (lower(immutable_unaccent(trade_name)) text_pattern_ops)
    WHERE is_published = true;
