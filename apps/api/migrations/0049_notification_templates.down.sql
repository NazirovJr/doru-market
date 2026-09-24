-- Down-миграция для 0049_notification_templates.sql (DTJ-369).

DROP TABLE IF EXISTS notification_templates;
DROP TYPE IF EXISTS notification_channel;
