-- export_jobs (DTJ-361, SRS-ADM-073/085) — [ДОПОЛНЕНИЕ]: таблица отсутствует в
-- 11-database-schema.md/27-module-admin-moderation-onboarding.md §10.1, хотя SRS-ADM-073
-- ссылается на GET /reports/export-jobs/:exportJobId. Минимальная схема, подлежит утверждению
-- архитектором при следующей сверке ADR (см. «Риски» тикета).

DO $$ BEGIN
  CREATE TYPE "export_job_format" AS ENUM ('csv', 'xlsx');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "export_job_status" AS ENUM ('processing', 'ready', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS export_jobs (
    id UUID PRIMARY KEY,
    report_type VARCHAR(100) NOT NULL,
    params JSONB NOT NULL,
    format export_job_format NOT NULL,
    status export_job_status NOT NULL DEFAULT 'processing',
    download_url TEXT,
    requested_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

COMMENT ON TABLE export_jobs IS
    'Асинхронная джоба экспорта отчёта (период > 31 дня, DTJ-361 AC2). Ключ объекта MinIO — '
    'детерминированная функция от id (report-exports/{id}.{format}) — повторный запуск BullMQ '
    'перезаписывает тот же объект (DTJ-361 AC3, SRS-ADM-085).';
