-- =============================================================================
-- 0008_user_telegram_identities.sql — EP-01 (DTJ-027)
-- =============================================================================
-- Связь (M:1) между Telegram-пользователем (по `telegram_user_id`, BIGINT)
-- и нашим `users.id` в конкретном тенанте. Документационный пробел:
-- `SRS-API-031` шаг 9 ссылается на эту таблицу, но она ОТСУТСТВУЕТ в
-- 45-табличном DDL `docs/spec/11-database-schema.md` (та же природа, что
-- для `idempotency_keys` в DTJ-017 и `auth_sessions` в DTJ-015).
-- Реализация — по прямой цитате SRS без додумывания сверх сказанного.
--
-- ОТЛОЖЕННЫЙ FK (конвенция EP-01, см. 0013_users_base.sql):
--   - tenant_id REFERENCES tenants(id) — добавляется EP-02 (DTJ-052).
--
-- FK на users(id) — НЕ отложенный (users уже существует, 0013_users_base.sql).
-- ON DELETE CASCADE — при удалении пользователя все его Telegram-identity
-- удаляются (GDPR-право на удаление ПДн, SRS-DB-004).
--
-- HOT-PATH индекс:
--   - UNIQUE (tenant_id, telegram_user_id) — find-or-create на каждом
--     `POST /auth/telegram` (DTJ-027 §3.9). UNIQUE-индекс = O(log n) lookup.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_telegram_identities (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id  BIGINT       NOT NULL,
  tenant_id         UUID         NOT NULL                   -- FK → tenants(id) [EP-02]
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_telegram_user_per_tenant
  ON user_telegram_identities (tenant_id, telegram_user_id);
