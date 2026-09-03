/**
 * `PgEscrowReconciliationScannerAdapter` (DTJ-247) — реализация `EscrowReconciliationScannerPort`
 * поверх `pg.Pool` (см. JSDoc `escrow-reconciliation.job.ts` — формула SRS-PAY-010 пересчитана
 * в SQL, не через `EscrowLedger.isBalanced()`, недостижимый отсюда).
 *
 * ОДИН агрегирующий запрос на весь тик (не N+1 по заказам, см. «Риски» тикета про производительность):
 *  1. Внутренний `SELECT DISTINCT order_id` — заказы с ХОТЯ БЫ одной записью `escrow_ledger` за
 *     `since` (буквальный текст тикета).
 *  2. Внешний `GROUP BY` — суммирует ВСЕ (не только недавние) записи КАЖДОГО такого заказа по
 *     формуле SRS-PAY-010, используя `ix_escrow_ledger_created_at` для шага 1 (`migrations/
 *     0034_support_tickets_audit_log.sql`).
 *  3. `HAVING discrepancy != 0` — расхождение вычисляется В SQL, не постфильтром в JS (меньше
 *     трафика между Postgres и Node).
 *
 * Только `SELECT` — джоба НЕ мутирует `escrow_ledger`/`orders` ни при каком результате (DoD).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { ESCROW_RECONCILIATION_DB_POOL } from './escrow-reconciliation.constants.js'
import type { EscrowReconciliationScannerPort, ImbalancedOrder } from './escrow-reconciliation.job.js'

const DISCREPANCY_QUERY = `
  SELECT
    o.tenant_id AS tenant_id,
    e.order_id AS order_id,
    SUM(CASE WHEN e.entry_type = 'hold_created' THEN e.amount_diram ELSE 0 END)
      - SUM(CASE WHEN e.entry_type IN ('platform_fee_captured', 'captured_to_pharmacy', 'refunded_to_customer', 'partially_refunded') THEN e.amount_diram ELSE 0 END)
      - SUM(CASE WHEN e.entry_type = 'adjustment' AND e.direction = 'credit' THEN e.amount_diram ELSE 0 END)
      + SUM(CASE WHEN e.entry_type = 'adjustment' AND e.direction = 'debit' THEN e.amount_diram ELSE 0 END)
      AS discrepancy_diram
  FROM escrow_ledger e
  JOIN orders o ON o.id = e.order_id
  WHERE e.order_id IN (SELECT DISTINCT order_id FROM escrow_ledger WHERE created_at >= $1)
  GROUP BY o.tenant_id, e.order_id
  HAVING (
    SUM(CASE WHEN e.entry_type = 'hold_created' THEN e.amount_diram ELSE 0 END)
      - SUM(CASE WHEN e.entry_type IN ('platform_fee_captured', 'captured_to_pharmacy', 'refunded_to_customer', 'partially_refunded') THEN e.amount_diram ELSE 0 END)
      - SUM(CASE WHEN e.entry_type = 'adjustment' AND e.direction = 'credit' THEN e.amount_diram ELSE 0 END)
      + SUM(CASE WHEN e.entry_type = 'adjustment' AND e.direction = 'debit' THEN e.amount_diram ELSE 0 END)
  ) != 0
`

interface DiscrepancyRow {
  readonly tenant_id: string
  readonly order_id: string
  readonly discrepancy_diram: string
}

@Injectable()
export class PgEscrowReconciliationScannerAdapter implements EscrowReconciliationScannerPort {
  constructor(@Inject(ESCROW_RECONCILIATION_DB_POOL) private readonly pool: Pool) {}

  async findImbalancedOrders(since: Date): Promise<readonly ImbalancedOrder[]> {
    const result = await this.pool.query<DiscrepancyRow>(DISCREPANCY_QUERY, [since])
    return result.rows.map((row) => ({
      orderId: row.order_id,
      tenantId: row.tenant_id,
      discrepancyDiram: BigInt(row.discrepancy_diram),
    }))
  }
}
