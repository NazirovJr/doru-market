-- Down-миграция для 0063_export_jobs.sql (DTJ-361).

DROP TABLE IF EXISTS export_jobs;
DROP TYPE IF EXISTS export_job_status;
DROP TYPE IF EXISTS export_job_format;
