-- =============================================================================
-- 0014_otp_codes.sql — EP-01 (DTJ-015 + DTJ-023)
-- =============================================================================
-- Хранит ХЕШИ OTP-кодов, не сами коды (SRS-API-021). Сырой код существует только
-- в стеке RequestOtpUseCase и передаётся в SmsProvider, после чего забывается.
--
-- ОТЛОЖЕННЫЙ FK (по конвенции EP-01, см. 0013_users_base.sql §«ОТЛОЖЕННЫЕ FK»):
--   - tenant_id REFERENCES tenants(id) — добавляется EP-02 (DTJ-052).
--
-- HOT-PATH индекс (SRS-DB-008):
--   - (tenant_id, subject_ref, purpose, expires_at) — findActive в VerifyOtpUseCase.
--
-- UNIQUENESS active-кода (anti-spam):
--   - (tenant_id, subject_ref, purpose) WHERE consumed_at IS NULL — на одного
--     пользователя не более одного активного кода на purpose. Повторный запрос
--     (RequestOtpUseCase) либо потребляет старый, либо ждёт cooldown (rate limit).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS otp_codes (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL,                   -- FK → tenants(id) [EP-02, DTJ-052]
  subject_ref   VARCHAR(64)  NOT NULL,
  purpose       VARCHAR(32)  NOT NULL DEFAULT 'login',
  code_hash     VARCHAR(64)  NOT NULL,
  attempts      INTEGER      NOT NULL DEFAULT 0,
  issued_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL,
  consumed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_otp_codes_active_by_subject
  ON otp_codes (tenant_id, subject_ref, purpose, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_otp_codes_uniq_active
  ON otp_codes (tenant_id, subject_ref, purpose)
  WHERE consumed_at IS NULL;

ALTER TABLE otp_codes
  DROP CONSTRAINT IF EXISTS chk_otp_codes_attempts_nonneg;
ALTER TABLE otp_codes
  ADD CONSTRAINT chk_otp_codes_attempts_nonneg CHECK (attempts >= 0);
