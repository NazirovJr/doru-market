-- =============================================================================
-- 0024_i18n_overrides_review_status.sql — EP-07 (DTJ-103, SRS-CAT-038..041)
-- =============================================================================
-- Номер пересчитан CTO на старте тикета (см. пометка [ИЗМЕНЕНО] в DTJ-103.md):
-- `0008` из исходного тикета занят дважды (`0008_onboarding_foundation`,
-- `0008_user_telegram_identities`), последняя применённая на момент старта —
-- `0023_orders_cart`. `0025` зарезервирован за DTJ-228 — не занимать.
--
-- `i18n_overrides` (`docs/spec/11-database-schema.md` §45, строка ~1373) ЕЩЁ НЕ
-- существует ни в одной ранее применённой миграции, ни в `apps/api/src/db/schema/`
-- на момент старта этого тикета (сверено: `grep -rln i18n_overrides apps/api/migrations
-- apps/api/src/db/schema` — ноль совпадений). DTJ-103 явно предусматривает этот
-- случай («Риски», п.2): таблица заводится ЭТОЙ миграцией целиком, колонка
-- `review_status` — её собственное расширение. `IF NOT EXISTS` — идемпотентность
-- (SRS-DB-037, тот же приём, что `0020_inventory_sync_errors.sql`) и защита от
-- гонки, если другой тикет параллельно заведёт таблицу первым.
--
-- Колонки — 1:1 по DDL `11-database-schema.md` §45: `tenant_id`/`locale`/
-- `translation_key`/`value`/`updated_at`, PK `(tenant_id, locale, translation_key)`.
-- ВНИМАНИЕ: имена колонок в самом тексте DTJ-103 («Что сделать» п.1, критерии
-- приёмки — `key`/`text`) РАСХОДЯТСЯ с фактическим DDL таблицы-владельца
-- (`translation_key`/`value`) — по иерархии документов AGENTS.md
-- (`docs/spec/` выше `tickets/`) используется DDL, не текст тикета; см. отчёт
-- сдачи, раздел «disputed».
--
-- `review_status` — 'pending_legal_review' | 'approved' (DTJ-103 «Что сделать» п.1):
-- блокирует ТОЛЬКО visual-индикатор в apps/admin, НЕ блокирует показ пользователю
-- (SRS-CAT-041) — юридический текст обязан существовать с первого дня даже в
-- ASSUMPTION-версии.

CREATE TABLE IF NOT EXISTS i18n_overrides (
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    locale           VARCHAR(5) NOT NULL,
    translation_key  VARCHAR(255) NOT NULL,
    value            TEXT NOT NULL,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, locale, translation_key)
);

ALTER TABLE i18n_overrides
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'pending_legal_review';

-- Postgres не поддерживает `ADD CONSTRAINT IF NOT EXISTS` — DO-блок + подавление
-- `duplicate_object` (тот же приём, что `0002_enums.sql`) делает повторный запуск no-op.
DO $$ BEGIN
    ALTER TABLE i18n_overrides
        ADD CONSTRAINT chk_i18n_overrides_review_status
        CHECK (review_status IN ('pending_legal_review', 'approved'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE i18n_overrides IS
    'Точечное переопределение строки словаря packages/i18n для КОНКРЕТНОГО тенанта без редеплоя '
    '(White-Label кастомизация текста, Charter §3.4) + версионируемый источник юридического '
    'текста блока аналогов (`catalog.analogs.*`, DTJ-103, SRS-CAT-041). review_status управляет '
    'ТОЛЬКО индикатором в apps/admin, не показом пользователю.';
