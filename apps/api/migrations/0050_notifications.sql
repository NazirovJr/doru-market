-- notifications (DTJ-370, docs/spec/11-database-schema.md §44, SRS-ADM-057/060/084).
-- notification_channel УЖЕ создан 0049 (DTJ-369) СО ЗНАЧЕНИЕМ 'in_app' — отдельная
-- миграция "ALTER TYPE ... ADD VALUE" из текста тикета DTJ-370 не нужна (расхождение
-- зафиксировано в notification-event-matrix.ts).

DO $$ BEGIN
  CREATE TYPE "notification_status" AS ENUM (
    'queued',
    'sent',
    'delivered',
    'failed',
    'suppressed_rate_limit'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel notification_channel NOT NULL,
    event_type VARCHAR(100),
    status notification_status NOT NULL DEFAULT 'queued',
    payload JSONB NOT NULL,
    throttle_key VARCHAR(255),
    source_event_id UUID,
    sent_at TIMESTAMPTZ,
    failed_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_notifications_dedup UNIQUE (user_id, channel, source_event_id)
);

COMMENT ON TABLE notifications IS
    'Персистентный ЛОГ (не сама очередь — очередь исполнения в BullMQ/Redis). Отдельная запись на '
    'канал/попытку, читается apps/admin для диагностики недоставленных уведомлений.';

-- Курсорная пагинация ленты пользователя (DTJ-372, ListNotificationsUseCase): новые сверху,
-- при равенстве created_at — id по убыванию.
CREATE INDEX IF NOT EXISTS notifications_user_created_at_id_idx
    ON notifications (user_id, created_at DESC, id DESC);
