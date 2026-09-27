-- Down-миграция для 0061_pharmacy_api_keys_rotation.sql (DTJ-365).
-- ALTER TYPE ... ADD VALUE — необратимо (см. 0043/0054/0056/0058 down-файлы), остальное откатываем.
DROP INDEX IF EXISTS ix_pharmacy_api_keys_rotation_grace_pending;
ALTER TABLE pharmacy_api_keys DROP COLUMN IF EXISTS created_by;
ALTER TABLE pharmacy_api_keys DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE pharmacy_api_keys DROP COLUMN IF EXISTS rotated_from_key_id;
ALTER TABLE pharmacy_api_keys DROP COLUMN IF EXISTS rotation_grace_expires_at;
ALTER TABLE pharmacy_api_keys DROP COLUMN IF EXISTS revoke_reason;
ALTER TABLE pharmacy_api_keys DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE pharmacy_api_keys DROP COLUMN IF EXISTS require_mtls;
