-- Down-миграция для 0050_notifications.sql (DTJ-370).

DROP INDEX IF EXISTS notifications_user_created_at_id_idx;
DROP TABLE IF EXISTS notifications;
DROP TYPE IF EXISTS notification_status;
