/**
 * `PgBillingInvoiceOverdueAdapter` (DTJ-252) — реализация `BillingInvoiceOverduePort` поверх
 * `pg.Pool`. `due_at IS NOT NULL` — явный фильтр (C11, explicit over implicit для денежного
 * запроса), тот же приём, что `pg-unpaid-order-scanner.adapter.ts` (DTJ-253): `issued`-статус
 * ГАРАНТИРУЕТ `due_at` заполнен (`DrizzlePlatformBillingInvoiceRepository.issue`/
 * `PgCashCommissionAggregationAdapter.issueInvoice` оба пишут его при переходе `draft→issued`),
 * но SQL-предикат не полагается на это неявно.
 *
 * `markOverdue` — `UPDATE ... WHERE status = 'issued'`, не check-then-write: повторный вызов на
 * уже `overdue`/`paid` строке — 0 затронутых строк, не ошибка (см. JSDoc джобы про идемпотентность).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { BILLING_INVOICE_OVERDUE_DB_POOL } from './billing-invoice-overdue.constants.js'
import { BILLING_INVOICE_OVERDUE_PORT, type BillingInvoiceOverduePort, type OverdueUnpaidInvoice } from './billing-invoice-overdue.job.js'

const FIND_OVERDUE_UNPAID_INVOICES_QUERY = `
  SELECT id, chain_id
  FROM platform_billing_invoices
  WHERE status = 'issued'
    AND due_at IS NOT NULL
    AND due_at + ($2 * INTERVAL '1 day') < $1
`

const MARK_OVERDUE_QUERY = `
  UPDATE platform_billing_invoices SET status = 'overdue' WHERE id = $1 AND status = 'issued'
`

interface OverdueInvoiceRow {
  readonly id: string
  readonly chain_id: string
}

@Injectable()
export class PgBillingInvoiceOverdueAdapter implements BillingInvoiceOverduePort {
  constructor(@Inject(BILLING_INVOICE_OVERDUE_DB_POOL) private readonly pool: Pool) {}

  async findOverdueUnpaidInvoices(now: Date, gracePeriodDays: number): Promise<readonly OverdueUnpaidInvoice[]> {
    const result = await this.pool.query<OverdueInvoiceRow>(FIND_OVERDUE_UNPAID_INVOICES_QUERY, [now, gracePeriodDays])
    return result.rows.map((row) => ({ invoiceId: row.id, chainId: row.chain_id }))
  }

  async markOverdue(invoiceId: string): Promise<void> {
    await this.pool.query(MARK_OVERDUE_QUERY, [invoiceId])
  }
}

export const BILLING_INVOICE_OVERDUE_PORT_PROVIDER = {
  provide: BILLING_INVOICE_OVERDUE_PORT,
  useClass: PgBillingInvoiceOverdueAdapter,
} as const
