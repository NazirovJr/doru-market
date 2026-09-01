-- =====================================================================================
-- 0019_search_ranking_indexes.sql — EP-06 (DTJ-185)
-- =====================================================================================
-- Заполняет пробел, обнаруженный при реализации DTJ-185: `PostgresSearchProvider.search()`
-- (SRS-CAT-013..021) требует индексы и text-search конфигурацию, которые
-- `docs/spec/11-database-schema.md`/`20-module-catalog-search.md` называют существующим
-- прерогативом, но НИ ОДНА фактическая миграция их не создала —
-- `0006_catalog_core.sql` (DTJ-091) объявляет `medicines.search_vector`, но БЕЗ GIN-индекса
-- и БЕЗ trgm-индексов на `trade_name`/`inn_name`; `0018_search_schema_additions.sql` (DTJ-181)
-- явно ограничился только `pharmacy_reliability_scores`/`search_query_log`/префиксным
-- индексом (см. его собственный текст тикета, раздел «Что сделать» — ix_medicines_search_vector
-- там не упомянут). Тот же пробел независимо зафиксирован интеграционным тестом DTJ-186
-- (`postgres-search-suggest.adapter.integration.spec.ts`, JSDoc «Известное ограничение
-- окружения»). Без этих индексов DTJ-185 не может выполнить собственный DoD («план запроса —
-- индексы должны использоваться, а не seq scan») — это САМОДОСТАТОЧНОЕ дополнение (чистые
-- `CREATE INDEX IF NOT EXISTS`/idempotent DDL, без ALTER существующих таблиц), не пересекается
-- с `files_owned` DTJ-091/DTJ-181.
-- =====================================================================================

-- === 1. GIN на search_vector — CUJ-1, «цытрамон» → «Цитрамон» через полнотекстовый путь ===
CREATE INDEX IF NOT EXISTS ix_medicines_search_vector ON medicines USING GIN (search_vector);

-- === 2. GIN trgm на trade_name/inn_name — фолбэк fuzzy при отсутствии tsvector-хита (REQ-UX-13) ===
CREATE INDEX IF NOT EXISTS ix_medicines_trade_name_trgm ON medicines USING GIN (trade_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_medicines_inn_name_trgm ON medicines USING GIN (inn_name gin_trgm_ops);

-- === 3. pharmacy_inventory: партиальный индекс, ведущий с medicine_id (доступ search() — "по
--        медикаменту искать аптеки", а не наоборот) === существующий ix_pharmacy_inventory_by_medicine
--        (DTJ-141/143) ведёт с pharmacy_id — не покрывает этот шаблон доступа эффективно.
CREATE INDEX IF NOT EXISTS ix_pharmacy_inventory_medicine_instock
    ON pharmacy_inventory (medicine_id)
    WHERE quantity > 0;

-- === 4. tajik_ru — ЧАСТИЧНАЯ реализация SRS-DB-014/015, см. JSDoc postgres-search.sql.ts п.2 ===
-- COPY правил `russian` БЕЗ кастомного словаря `tajik_unaccent` (файл словаря — артефакт уровня
-- Docker-образа, `$SHAREDIR/tsearch_data/...`, недостижим отсюда). Поведение сейчас идентично
-- `'russian'`; создаётся, чтобы (а) запросы `plainto_tsquery('tajik_ru', ...)` не падали с
-- «text search configuration does not exist», (б) переключение `medicines.search_vector` на
-- `to_tsvector('tajik_ru', ...)` в будущем не требовало правки кода поиска — имя уже правильное.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'tajik_ru') THEN
    CREATE TEXT SEARCH CONFIGURATION tajik_ru (COPY = russian);
  END IF;
END$$;
COMMENT ON TEXT SEARCH CONFIGURATION tajik_ru IS
    'ЧАСТИЧНАЯ реализация SRS-DB-014/015 (DTJ-185): копия russian, БЕЗ словаря tajik_unaccent '
    '(ӣ→и, ӯ→у, ҳ→х, қ→к, ғ→г, ҷ→ч) — тот требует файл в Docker-образе Postgres. '
    'Поведение идентично russian до появления тикета, добавляющего словарь в образ.';
