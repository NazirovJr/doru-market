-- =====================================================================================
-- 0044_support_ticket_last_escalated_at.sql — EP-14 (DTJ-280), анти-дребезг эскалации
-- support_tickets. Номер сверен непосредственно перед созданием файла: `ls apps/api/migrations/`
-- — последняя запись на диске `0043_audit_action_category_cash_reconciliation.sql`, следующий
-- свободный — 0044.
--
-- ДОПОЛНЕНИЕ сверх буквального DDL DTJ-280 (тикет допускает ЛИБО updated_at, ЛИБО явную колонку
-- "если updated_at недостаточно специфично") — updated_at мутируется ТАКЖЕ transitionTo() (смена
-- статуса), что сделало бы анти-дребезг эскалации false-negative при статусном переходе между
-- двумя тиками SupportSlaMonitorJob; явная колонка устраняет эту двусмысленность.
--
-- Идемпотентность (правило 11 AGENTS.md): `ADD COLUMN IF NOT EXISTS` — нативно идемпотентно.
-- =====================================================================================

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ;
COMMENT ON COLUMN support_tickets.last_escalated_at IS
    'DTJ-280 (SRS-ADM-076): момент последней эскалации priority джобой SupportSlaMonitorJob. '
    'NULL — тикет ещё ни разу не эскалирован. SQL-скан воркера использует это поле в WHERE, '
    'чтобы не повышать priority чаще, чем раз в SUPPORT_SLA_RE_ESCALATION_MINUTES.';

CREATE INDEX IF NOT EXISTS ix_support_tickets_sla_escalation_scan
    ON support_tickets (first_response_due_at)
    WHERE first_responded_at IS NULL AND status IN ('open', 'in_progress');
