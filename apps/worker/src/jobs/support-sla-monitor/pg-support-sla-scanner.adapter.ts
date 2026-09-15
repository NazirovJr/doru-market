/**
 * `PgSupportSlaScannerAdapter` (EP-14, DTJ-280) — реализация `SupportSlaTicketScannerPort`
 * (`support-sla-monitor.job.ts`) поверх `pg.Pool`, таблица `support_tickets`. Тот же приём, что
 * `pg-pickup-sla-order-scanner.adapter.ts` (DTJ-254): raw parametrized SQL, `apps/worker` не
 * импортирует Drizzle-схему `apps/api` (`02` §1.1 — межпроцессный SQL-доступ к общей таблице
 * ≠ межмодульный deep-import домена).
 *
 * Анти-дребезг повторной эскалации (критерий приёмки 3 DTJ-280) — ЗДЕСЬ, в `WHERE`
 * (`last_escalated_at`), не в `apps/api`-use case: тикет, эскалированный МЕНЕЕ
 * `reEscalationCooldownMinutes` назад, просто не попадает в выборку следующего тика.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { SUPPORT_SLA_MONITOR_DB_POOL } from './support-sla-monitor.constants.js'
import type { OverdueSupportTicket, SupportSlaTicketScannerPort } from './support-sla-monitor.job.js'

const OVERDUE_TICKETS_QUERY = `
  SELECT id AS ticket_id, tenant_id
  FROM support_tickets
  WHERE first_response_due_at < $1
    AND first_responded_at IS NULL
    AND status IN ('open', 'in_progress')
    AND (last_escalated_at IS NULL OR last_escalated_at < $1::timestamptz - ($2 || ' minutes')::interval)
`

interface OverdueTicketRow {
  readonly ticket_id: string
  readonly tenant_id: string
}

@Injectable()
export class PgSupportSlaScannerAdapter implements SupportSlaTicketScannerPort {
  constructor(@Inject(SUPPORT_SLA_MONITOR_DB_POOL) private readonly pool: Pool) {}

  async findOverdueTickets(now: Date, reEscalationCooldownMinutes: number): Promise<readonly OverdueSupportTicket[]> {
    const result = await this.pool.query<OverdueTicketRow>(OVERDUE_TICKETS_QUERY, [now, reEscalationCooldownMinutes])
    return result.rows.map((row) => ({ ticketId: row.ticket_id, tenantId: row.tenant_id }))
  }
}
