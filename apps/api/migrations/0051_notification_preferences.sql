-- notification_preferences (DTJ-371, docs/spec/27-module-admin-moderation-onboarding.md §6.4,
-- SRS-ADM-058/059). notification_channel уже создан 0049 (DTJ-369) — переиспользуется как есть.

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- 'order_updates' | 'promotions' | 'onboarding_alerts' | 'delivery_otp' | ...
    channel notification_channel NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, category, channel)
);

COMMENT ON TABLE notification_preferences IS
    'SRS-ADM-058/059. Критичные категории (order_updates для активного заказа, delivery_otp) '
    'принудительно is_enabled=true и игнорируют quiet_hours — защищено доменом '
    '(NotificationPreference.create/shouldSuppressNow), не только формой.';
