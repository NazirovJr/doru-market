/**
 * `PgSupportTicketAdapter` (DTJ-247) — реализация `SupportTicketPort` (`escrow-reconciliation.
 * job.ts`) поверх `pg.Pool`, таблица `support_tickets` (`migrations/
 * 0034_support_tickets_audit_log.sql`).
 *
 * «ОТКРЫТЫЙ» (SRS-PAY-042, буквальный текст тикета) — `status NOT IN ('resolved', 'closed')`
 * (ASSUMPTION: `support_ticket_status` несёт 4 значения `open`/`in_progress`/`resolved`/
 * `closed` — «открытый» трактуется как «ещё не доведён до финального состояния», не узко
 * `status='open'`: тикет, который оператор уже взял в работу (`in_progress`), тоже не должен
 * дублироваться повторным автообнаружением ТОГО ЖЕ расхождения).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { ESCROW_RECONCILIATION_DB_POOL } from './escrow-reconciliation.constants.js'
import type { CreateSystemAutoPaymentIssueTicketInput, SupportTicketPort } from './escrow-reconciliation.job.js'

const FIND_OPEN_TICKET_QUERY = `
  SELECT id
  FROM support_tickets
  WHERE order_id = $1
    AND category = 'payment_issue'
    AND status NOT IN ('resolved', 'closed')
    AND created_at >= NOW() - ($2 || ' days')::interval
  ORDER BY created_at DESC
  LIMIT 1
`

const CREATE_TICKET_QUERY = `
  INSERT INTO support_tickets (order_id, tenant_id, channel, category, is_escrow_blocking, status, description)
  VALUES ($1, $2, 'system_auto', 'payment_issue', false, 'open', $3)
  RETURNING id
`

@Injectable()
export class PgSupportTicketAdapter implements SupportTicketPort {
  constructor(@Inject(ESCROW_RECONCILIATION_DB_POOL) private readonly pool: Pool) {}

  async findOpenPaymentIssueTicket(orderId: string, dedupDays: number): Promise<{ ticketId: string } | null> {
    const result = await this.pool.query<{ id: string }>(FIND_OPEN_TICKET_QUERY, [orderId, dedupDays])
    const row = result.rows[0]
    return row === undefined ? null : { ticketId: row.id }
  }

  async createSystemAutoPaymentIssueTicket(input: CreateSystemAutoPaymentIssueTicketInput): Promise<{ ticketId: string }> {
    const result = await this.pool.query<{ id: string }>(CREATE_TICKET_QUERY, [input.orderId, input.tenantId, input.description])
    const row = result.rows[0]
    if (row === undefined) {
      throw new Error(`PgSupportTicketAdapter: INSERT support_tickets did not return an id for order ${input.orderId}`)
    }
    return { ticketId: row.id }
  }
}
