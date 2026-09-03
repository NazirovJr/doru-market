-- Down-миграция для 0034_support_tickets_audit_log.sql (DTJ-247).
-- Обратный порядок: индексы (падают вместе с таблицей автоматически, явный DROP INDEX не
-- обязателен, но перечислен для симметрии/явности), затем таблицы (support_tickets ссылается
-- на orders/tenants/users, не на audit_log — порядок между собой не важен), затем enum'ы.
-- REVOKE ничего не требует откатывать — таблица удаляется целиком.
-- ВНИМАНИЕ: DROP TYPE упадёт, если в схеме остались колонки этого типа (тот же принцип, что
-- 0029_payments.down.sql).
-- ВНИМАНИЕ: `ix_escrow_ledger_created_at` НЕ удаляется здесь — она принадлежит существующей
-- таблице escrow_ledger (0029_payments.sql), не создаваемой этой миграцией; удаление индекса на
-- чужой таблице оставлено закомментированным ниже на усмотрение того, кто откатывает 0034.

DROP INDEX IF EXISTS ix_audit_log_entity;
DROP INDEX IF EXISTS ix_support_tickets_order_category_status;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS support_tickets;

DROP TYPE IF EXISTS "audit_action_category";
DROP TYPE IF EXISTS "support_ticket_status";
DROP TYPE IF EXISTS "support_ticket_category";
DROP TYPE IF EXISTS "support_ticket_channel";

-- Раскомментировать при полном откате волны, если индекс на escrow_ledger.created_at
-- действительно нужно снять (обычно НЕ снимается — полезен независимо от этой миграции):
-- DROP INDEX IF EXISTS ix_escrow_ledger_created_at;
