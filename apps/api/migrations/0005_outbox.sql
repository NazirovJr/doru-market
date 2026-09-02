-- 0005_outbox.sql (EP-01, DTJ-016, SRS-DOM-151/152, SRS-DB-024).
--
-- Transactional outbox + журнал идемпотентности потребителей.
--
-- `outbox` — append-only по соглашению (UPDATE разрешён только для `status`/`publishedAt`/
-- `publishAttempts` со стороны OutboxRelayWorker, НЕ для пользовательского кода). Финальный
-- `GRANT` (`app_role` получает `INSERT, SELECT` без `UPDATE, DELETE`) — отдельный
-- DBA-скрипт, не этот тикет (см. JSDoc outbox.schema.ts).
--
-- `processed_events` — составной PK `(consumer_name, event_id)`, конфликт вставки
-- = «уже обработано» (SRS-DOM-152).

-- Идемпотентность (часть 3 задания по починке дедлока на свежей БД): `CREATE TYPE`
-- не поддерживает `IF NOT EXISTS` — оборачиваем в DO-блок, глушим только
-- `duplicate_object`. `CREATE TABLE`/`CREATE INDEX` ниже получают `IF NOT EXISTS`.
-- Повторный прогон становится no-op, схема не меняется ни на байт.
DO $$ BEGIN
  CREATE TYPE "outbox_status" AS ENUM ('pending', 'published', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" varchar(100) NOT NULL,
  "aggregate_type" varchar(50) NOT NULL,
  "aggregate_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "tenant_id" uuid,
  "status" "outbox_status" NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  "publish_attempts" integer NOT NULL DEFAULT 0
);

-- Partial index — оптимизация `WHERE status='pending' ORDER BY created_at`
-- (используется в `OutboxRelayWorker`).
CREATE INDEX IF NOT EXISTS "outbox_pending_created_at_idx" ON "outbox" ("created_at") WHERE "status" = 'pending';

CREATE TABLE IF NOT EXISTS "processed_events" (
  "consumer_name" varchar(100) NOT NULL,
  "event_id" uuid NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("consumer_name", "event_id")
);
