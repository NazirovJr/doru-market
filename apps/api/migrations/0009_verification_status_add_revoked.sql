-- =============================================================================
-- 0009_verification_status_add_revoked.sql — EP-03 (DTJ-063)
-- =============================================================================
-- [ДОПОЛНЕНИЕ] `pharmacy_verification.verification_status`: новое допустимое
-- значение 'revoked' (SRS-ADM-017, отзыв верификации).
--
-- ПОЧЕМУ ЭТО БОЛЬШЕ НЕ `ALTER TYPE`:
-- Файл изначально писался в предположении, что `verification_status` — это
-- PostgreSQL ENUM-тип (см. `docs/spec/11-database-schema.md:182-184`,
-- `docs/spec/27-module-admin-moderation-onboarding.md:980-981`, D-22). На
-- практике `0008_onboarding_foundation.sql:105` объявляет колонку как
-- `VARCHAR(32) NOT NULL DEFAULT 'not_started'`, и Drizzle-схема подтверждает
-- это (`apps/api/src/db/schema/pharmacy-verification.ts:32`,
-- `varchar('verification_status', { length: 32 })`) — enum-типа
-- `verification_status` в БД не существует, `ALTER TYPE` падал с
-- `type "verification_status" does not exist`. Источник истины — Drizzle-схема
-- (правки .ts вне мандата этой миграции), поэтому колонка ОСТАЁТСЯ VARCHAR(32),
-- а контроль допустимых значений на уровне БД выражается CHECK-ограничением
-- вместо ALTER TYPE — тот же смысл (валидные статусы фиксированы схемой БД),
-- другой механизм.
--
-- ПОЛНЫЙ ПЕРЕЧЕНЬ (не домысел — сведён из двух источников, не противоречащих
-- друг другу, оба процитированы в исходной версии этого файла):
--   - база из 5 значений — `docs/spec/11-database-schema.md:182-184`
--     (`CREATE TYPE verification_status AS ENUM ('not_started',
--     'pending_review', 'changes_requested', 'verified', 'rejected')`, D-22);
--   - + 'revoked' — `docs/spec/27-module-admin-moderation-onboarding.md:980-981`
--     (SRS-ADM-017, то самое дополнение, ради которого писался этот файл).
-- Текущий application-код (`apps/api/src/modules/onboarding/application/
-- use-cases/*`) реально присваивает колонке только подмножество
-- {'not_started','pending_review','verified','revoked'} — 'changes_requested'
-- и 'rejected' в коде идут через ОТДЕЛЬНЫЕ поля `pharmacy_chains.status` /
-- `pharmacies.status`, не через `pharmacy_verification.verification_status`.
-- Это не противоречие: CHECK — это домен допустимых значений КОЛОНКИ по
-- спецификации, а не аудит фактически используемых на сегодня веток кода;
-- более узкое использование кодом сегодня не делает лишние значения домена
-- ошибочными и не сужает список ниже уже написанного кода (иначе он начал бы
-- отклонять валидные для кода 'not_started'/'pending_review'/'verified'/
-- 'revoked' — что и было бы дефектом).
--
-- ALTER TABLE ... ADD CONSTRAINT (в отличие от ALTER TYPE ... ADD VALUE) не
-- требует выполнения вне транзакции (SRS-DB-009 касается только добавления
-- значения PostgreSQL ENUM в той же транзакции, где оно создано) — директива
-- `disable-transaction` больше не нужна и снята.
--
-- Guard по pg_constraint (конвенция уже применена в 0015a
-- `chk_sync_batches_session_only_for_full`) — повторный прогон файла не падает
-- на "constraint already exists".
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pharmacy_verification_verification_status'
  ) THEN
    ALTER TABLE pharmacy_verification
      ADD CONSTRAINT chk_pharmacy_verification_verification_status
      CHECK (verification_status IN (
        'not_started',
        'pending_review',
        'changes_requested',
        'verified',
        'rejected',
        'revoked'
      ));
  END IF;
END
$$;
