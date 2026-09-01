-- =============================================================================
-- 0015_auth_sessions.sql — EP-01 (DTJ-024)
-- =============================================================================
-- Материализованная сессия пользователя, ВЛАДЕЮЩАЯ refresh-токеном (в виде
-- sha256-hash, SRS-API-025). `auth_sessions.id` упоминается в JWT-claim'е
-- `sessionId` (SRS-API-024) — используется для revoke (DTJ-026) и аудита.
--
-- ОТЛОЖЕННЫЙ FK (по конвенции EP-01, см. 0013_users_base.sql):
--   - tenant_id REFERENCES tenants(id) — добавляется EP-02 (DTJ-052).
--
-- FK на users(id) — НЕ отложенный (users уже существует, 0013_users_base.sql).
-- ON DELETE CASCADE — при удалении пользователя все его сессии удаляются
-- (GDPR-право на удаление ПДн, SRS-DB-004).
--
-- HOT-PATH индексы (SRS-API-024/025):
--   - (user_id, revoked_at) — «список активных сессий пользователя» (DTJ-026).
--   - (refresh_token_hash) UNIQUE — refresh-rotation и detect-reuse (DTJ-025).
-- =============================================================================

CREATE TABLE IF NOT EXISTS auth_sessions (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID         NOT NULL,                   -- FK → tenants(id) [EP-02, DTJ-052]
  user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id             UUID         NOT NULL,
  refresh_token_hash    VARCHAR(64)  NOT NULL,                   -- sha256(opaque 32 bytes)
  device_label          VARCHAR(64)  NOT NULL,
  user_agent            TEXT         NOT NULL,
  ip_address            VARCHAR(45)  NOT NULL,                   -- IPv4 (15) + IPv6 (45) — VARCHAR надёжнее INET для R1
  absolute_expires_at   TIMESTAMPTZ  NOT NULL,                   -- now() + 30 дней
  revoked_at            TIMESTAMPTZ,                             -- NULL = активна
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_by_user
  ON auth_sessions (user_id, revoked_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_sessions_refresh_hash
  ON auth_sessions (refresh_token_hash);
