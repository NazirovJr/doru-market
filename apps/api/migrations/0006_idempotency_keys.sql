-- 0006_idempotency_keys.sql (EP-01, DTJ-017, SRS-API-009/010/076).
--
-- Закрывает документационный пробел — `idempotency_keys` упомянута в прозе
-- `12-api-conventions-auth-tenancy.md` (SRS-API-009/010), но отсутствует в
-- реестре DDL `docs/spec/11-database-schema.md`. Прямая цитата `SRS-API-010`:
-- «Хранение: таблица `idempotency_keys(user_id, endpoint, key, request_hash,
-- status, response_status, response_body, created_at)`, TTL
-- `IDEMPOTENCY_KEY_TTL_HOURS` (ASSUMPTION 24),
-- `UNIQUE(user_id, endpoint, key)`».
--
-- `ON DELETE CASCADE` от `users` — при удалении пользователя его
-- idempotency-записи удаляются вместе с ним (GDPR-style, нет orphan keys).
-- `status='processing'` создаётся СРАЗУ при получении заголовка, не постфактум
-- (SRS-API-010 «запрос с K ещё обрабатывается → 409 немедленно»).

-- Идемпотентность (часть 3 задания по починке дедлока на свежей БД): `CREATE TYPE`
-- не поддерживает `IF NOT EXISTS` — оборачиваем в DO-блок, глушим только
-- `duplicate_object`. `CREATE TABLE`/`CREATE UNIQUE INDEX` ниже получают `IF NOT EXISTS`.
-- Повторный прогон становится no-op, схема не меняется ни на байт.
DO $$ BEGIN
  CREATE TYPE "idempotency_key_status" AS ENUM ('processing', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint" varchar(255) NOT NULL,
  "key" uuid NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "status" "idempotency_key_status" NOT NULL DEFAULT 'processing',
  "response_status" integer,
  "response_body" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE(user_id, endpoint, key) — физический механизм детекции гонки
-- (SRS-API-010): конкурентный дубль ловит конфликт этого индекса.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_user_endpoint_key" ON "idempotency_keys" ("user_id", "endpoint", "key");
