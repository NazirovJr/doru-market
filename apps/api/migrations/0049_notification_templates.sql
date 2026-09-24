-- notification_templates: канал notification_channel — объединение спеки и кода EP-16 (in_app, email).

DO $$ BEGIN
  CREATE TYPE "notification_channel" AS ENUM (
    'telegram',
    'sms',
    'web_push',
    'email',
    'in_app'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    channel notification_channel NOT NULL,
    locale VARCHAR(5) NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    variables_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_templates UNIQUE (event_type, channel, locale)
);

COMMENT ON TABLE notification_templates IS
    'brandName — всегда плейсхолдер {{brandName}}, никогда не хардкод.';
