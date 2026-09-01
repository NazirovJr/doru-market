-- 0006_idempotency_keys.down.sql (EP-01, DTJ-017).

DROP INDEX IF EXISTS "unique_user_endpoint_key";
DROP TABLE IF EXISTS "idempotency_keys";
DROP TYPE IF EXISTS "idempotency_key_status";
