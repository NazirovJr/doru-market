/**
 * `RawSqlSupportTicketRepository` (EP-10, DTJ-243) — реализация `SupportTicketPort` поверх
 * `support_tickets` (миграция `0034_support_tickets_audit_log.sql`) через СЫРОЙ
 * `db.execute(sql\`...\`)` (тот же приём, что `DrizzleCartIdentityRepository`, DTJ-226) — НЕ
 * типизированный Drizzle `pgTable` (см. DISPUTED в JSDoc порта: `support_tickets`/`audit_log`
 * концептуально принадлежат `apps/api/src/db/schema/support.ts`, `files_owned` DTJ-270,
 * параллельно разрабатывается ДРУГИМ агентом — заводить здесь конкурирующий `pgTable`/`pgEnum`
 * с теми же именами гарантированно конфликтует при мерже).
 *
 * `channel='system_auto'`, `created_by=NULL` — ВСЕГДА (см. `COMMENT ON TABLE support_tickets`:
 * «NULL для channel='system_auto'»), этот адаптер не принимает актора-человека.
 */
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import {
  SUPPORT_TICKET_PORT,
  type CreateSystemAutoTicketInput,
  type SupportTicketPort,
} from '@/modules/payments/application/ports/support-ticket.port.js'

const SYSTEM_AUTO_CHANNEL = 'system_auto'
const ESCROW_BLOCKING_FALSE = false

@Injectable()
export class RawSqlSupportTicketRepository implements SupportTicketPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async createSystemAutoTicket(input: CreateSystemAutoTicketInput): Promise<{ readonly ticketId: string }> {
    const result = await this.db.execute(sql`
      INSERT INTO support_tickets (tenant_id, order_id, channel, category, is_escrow_blocking, description)
      VALUES (${input.tenantId}, ${input.orderId}, ${SYSTEM_AUTO_CHANNEL}, ${input.category}, ${ESCROW_BLOCKING_FALSE}, ${input.description})
      RETURNING id AS "ticketId"
    `)
    const ticketId = firstTicketId(result)
    if (ticketId === null) {
      throw new Error('RawSqlSupportTicketRepository: INSERT returned no id')
    }
    return { ticketId }
  }
}

function firstTicketId(result: unknown): string | null {
  const row = extractRows(result)[0]
  return row?.ticketId ?? null
}

/** Нормализация результата `db.execute` — тот же приём, что `DrizzleCartIdentityRepository`. */
function extractRows(result: unknown): readonly { readonly ticketId: string }[] {
  if (Array.isArray(result)) {
    return result as { readonly ticketId: string }[]
  }
  if (result !== null && typeof result === 'object' && 'rows' in result) {
    const rows: unknown = (result as Record<string, unknown>).rows
    if (Array.isArray(rows)) {
      return rows as { readonly ticketId: string }[]
    }
  }
  return []
}

export const SUPPORT_TICKET_PORT_PROVIDER = {
  provide: SUPPORT_TICKET_PORT,
  useClass: RawSqlSupportTicketRepository,
} as const
