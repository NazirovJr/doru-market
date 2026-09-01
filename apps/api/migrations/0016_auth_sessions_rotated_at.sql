-- =============================================================================
-- 0016_auth_sessions_rotated_at.sql — EP-01 (DTJ-025)
-- =============================================================================
-- Расширение таблицы `auth_sessions` (0015_auth_sessions.sql) для
-- refresh-rotation + reuse-detection (SRS-API-026/027):
--
--   1) `rotated_at TIMESTAMPTZ NULL` — признак «уже ротированного звена»
--      refresh-цепочки. Заполняется атомарно с INSERT новой `auth_sessions`-
--      записи (DTJ-025 §2.6, `revokeCurrentAndCreateNext`). NULL = текущее
--      звено цепочки; NOT NULL = прошлое звено, предъявление такого токена
--      триггерит REUSE_DETECTED.
--
--   2) `revoke_reason VARCHAR(32) NULL` — диагностическое поле для аудита
--      (SRS-API-029/030, DTJ-026): 'user_logout' / 'user_logout_all' /
--      'reuse_detected' / 'admin_force' (последнее — в EP-15). Не влияет
--      на логику — только для логов и post-mortem расследований.
--
--   3) Индекс `ix_auth_sessions_by_family` — для `UPDATE ... WHERE family_id
--      = :fid AND revoked_at IS NULL` (`revokeAllByFamilyId`, DTJ-025 §2.3).
--      Без индекса этот запрос делает seq.scan по всей таблице — на R1
--      объём мал, но в проде у пользователя могут быть десятки семей
--      (multi-device), и эта операция вызывается при каждом reuse-detect.
--
-- Совместимость: эволюционная миграция — добавляет NULLable-колонки и
-- индекс, существующие строки остаются NULL/нетронутыми. Деплой без даунтайма.
-- =============================================================================

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS rotated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoke_reason  VARCHAR(32);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_by_family
  ON auth_sessions (family_id);
