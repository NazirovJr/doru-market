-- =====================================================================================
-- 0061_pharmacy_api_keys_rotation.sql — EP-05/EP-03 (DTJ-365).
-- =====================================================================================
-- Расширяет `pharmacy_api_keys` (0015a) под ротацию с периодом перекрытия, mTLS-флаг и
-- полноценный отзыв (SRS-ADM-043..046):
--   - require_mtls: булев флаг per-key, дефолт false (шаг 4 верификации был всегда пропущен —
--     см. JSDoc drizzle-pharmacy-api-key-verification.adapter.ts).
--   - revoked_at/revoke_reason: явный отзыв ВМЕСТО перегрузки свободного текстового `note`.
--   - rotation_grace_expires_at: дедлайн, до которого СТАРЫЙ (заменённый ротацией) ключ ещё
--     валиден параллельно с новым (SRS-API-034); ставится на СТАРУЮ строку при rotate.
--   - rotated_from_key_id: на НОВОЙ строке — ссылка на ключ, который она заменила.
--   - last_used_at/created_by: заполняются кодом (verification adapter / create use case),
--     не декоративные — см. отчёт сдачи.
--
-- Идемпотентность — `ADD COLUMN IF NOT EXISTS` (правило 11 AGENTS.md).
-- =====================================================================================

ALTER TABLE pharmacy_api_keys ADD COLUMN IF NOT EXISTS require_mtls BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE pharmacy_api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE pharmacy_api_keys ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
ALTER TABLE pharmacy_api_keys ADD COLUMN IF NOT EXISTS rotation_grace_expires_at TIMESTAMPTZ;
ALTER TABLE pharmacy_api_keys ADD COLUMN IF NOT EXISTS rotated_from_key_id UUID
    REFERENCES pharmacy_api_keys(id) ON DELETE SET NULL;
ALTER TABLE pharmacy_api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE pharmacy_api_keys ADD COLUMN IF NOT EXISTS created_by UUID
    REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN pharmacy_api_keys.rotation_grace_expires_at IS
    'DTJ-365: дедлайн, до которого этот (старый, замещённый ротацией) ключ ещё проходит '
    'верификацию параллельно с новым. NULL — ключ никогда не был заменён ротацией.';

-- Скан RevokeExpiredRotatedKeysJob (apps/worker): «старые» ключи с истёкшим грейс-периодом,
-- ещё не отозванные — частичный индекс, не общий по колонке (строк с NOT NULL немного).
CREATE INDEX IF NOT EXISTS ix_pharmacy_api_keys_rotation_grace_pending
    ON pharmacy_api_keys (rotation_grace_expires_at)
    WHERE rotation_grace_expires_at IS NOT NULL AND revoked_at IS NULL;

DO $$ BEGIN
  ALTER TYPE "audit_action_category" ADD VALUE IF NOT EXISTS 'pharmacy_api_key';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
