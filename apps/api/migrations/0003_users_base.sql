-- =============================================================================
-- 0003_users_base.sql — EP-01 (DTJ-014)
-- Переномеровано с 0013 -> 0003: users не имеет входящих зависимостей (FK на
-- tenants/pharmacies/pharmacy_chains ниже — ОТЛОЖЕННЫЕ), а 0006_idempotency_keys,
-- 0007_users_phone_nullable и 0008_user_telegram_identities ссылаются на users
-- и должны применяться ПОСЛЕ неё. Миграции нигде не были применены на момент
-- переномерации — догоняющая миграция не требуется.
-- =============================================================================
-- Единая таблица идентичности `users` для ВСЕХ 6 ролей (SRS-API-017).
-- Различие в guard/policy application-слоя, НЕ в схеме.
--
-- ОТЛОЖЕННЫЕ FK (см. tickets/ep01-foundation/DTJ-014.md §«Технический контекст»):
--   - `tenant_id` REFERENCES tenants(id)         — добавляется EP-02 (DTJ-052)
--   - `pharmacy_id` REFERENCES pharmacies(id)     — добавляется EP-03 (DTJ-063)
--   - `chain_id` REFERENCES pharmacy_chains(id)   — добавляется EP-03
-- Это сознательный архитектурный паттерн (отложенные FK), не дыра в схеме.
-- `user_addresses.user_id REFERENCES users(id) ON DELETE CASCADE` — НЕ отложенный
-- (users уже существует в этом же тикете).
--
-- UNIQUE(tenant_id, phone_number) — изоляция White-Label: один номер — НЕЗАВИСИМЫЕ
-- аккаунты в разных тенантах (SRS-API-017).
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid() (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- ENUM `user_role` (SRS-API-014)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'customer',
      'pharmacist',
      'pharmacy_admin',
      'courier',
      'support_agent',
      'super_admin'
    );
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Table `users`
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL,                 -- FK → tenants(id)        [EP-02]
  phone_number        VARCHAR(20)  NOT NULL,
  role                user_role    NOT NULL DEFAULT 'customer',
  full_name           VARCHAR(255),
  pharmacy_id         UUID,                                  -- FK → pharmacies(id)     [EP-03]
  chain_id            UUID,                                  -- FK → pharmacy_chains(id)[EP-03]
  telegram_chat_id    BIGINT,
  preferred_locale    VARCHAR(5)   NOT NULL DEFAULT 'tj',
  is_active           BOOLEAN      NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ                           -- SRS-DB-004: soft delete (право на удаление ПДн)
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_phone_per_tenant
  ON users (tenant_id, phone_number)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_users_tenant_active
  ON users (tenant_id, is_active)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_users_telegram_chat_id
  ON users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Table `user_addresses` (1:N к users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_addresses (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_text        TEXT         NOT NULL,
  landmark_text       TEXT,
  landmark_photo_url  TEXT,
  entrance            VARCHAR(16),
  floor               VARCHAR(16),
  apartment           VARCHAR(16),
  latitude            NUMERIC(10, 8),
  longitude           NUMERIC(11, 8),
  is_default          BOOLEAN      NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_user_addresses_user
  ON user_addresses (user_id);
