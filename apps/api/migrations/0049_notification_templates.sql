-- =====================================================================================
-- 0049_notification_templates.sql — EP-16 (DTJ-369), таблица notification_templates
-- (SRS-ADM-054/055/056). DDL — ДОСЛОВНО docs/spec/27-module-admin-moderation-onboarding.md §10.1.
--
-- CREATE TYPE notification_channel — СОГЛАСОВАНИЕ двух разошедшихся источников (см. JSDoc
-- `enums.schema.ts:notificationChannelEnum` и `notification-template.entity.ts` §«Реестр
-- каналов»): docs/spec/11-database-schema.md объявляет ENUM ('telegram','sms','web_push','email'),
-- фактический код EP-16 (DTJ-368, NotifyProviderPort) использует ('telegram','sms','web_push',
-- 'in_app') — ни одна миграция до этой не создавала тип `notification_channel` в реальном
-- Postgres (первое использование — эта таблица). Тип создаётся здесь ОБЪЕДИНЕНИЕМ: `in_app`
-- добавлен (нужен почти каждой строке матрицы SRS-ADM-052), `email` сохранён (SRS-ADM-055
-- допускает для него subject, зарезервирован под будущее расширение).
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE TYPE` не поддерживает `IF NOT EXISTS` —
-- оборачиваем в DO-блок и глушим `duplicate_object` (тот же приём, что 0002_enums.sql).
-- `CREATE TABLE IF NOT EXISTS`, `COMMENT ON` — идемпотентны нативно.
-- =====================================================================================

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
    event_type VARCHAR(100) NOT NULL, -- ключ матрицы SRS-ADM-052, напр. 'order.paid'
    channel notification_channel NOT NULL,
    locale VARCHAR(5) NOT NULL, -- 'tj' | 'ru' | 'en'
    subject TEXT, -- заполнено только для channel IN ('email','web_push'), SRS-ADM-055
    body TEXT NOT NULL, -- плейсхолдеры {{var}}, простая подстановка (не шаблонизатор общего назначения)
    variables_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notification_templates UNIQUE (event_type, channel, locale)
);

COMMENT ON TABLE notification_templates IS
    'SRS-ADM-054/056. brandName ВСЕГДА плейсхолдер {{brandName}}, никогда не хардкод (D-01). '
    'CI-тест проверяет полноту матрицы: каждая (event_type, channel) из SRS-ADM-052 имеет строку '
    'на всех трёх locale.';
