/**
 * `PgUnpaidOrderScannerAdapter` (DTJ-253, SRS-ORD-032/033) — единственный `SELECT`, которым
 * джоба находит просроченные non-cash заказы. `payment_window_expires_at IS NOT NULL` — явный
 * фильтр (не полагаемся ТОЛЬКО на `<= NOW()` c `NULL`, который в SQL никогда не сравнивается
 * истинно — cash-заказы, у которых поле всегда `NULL`, и так не попали бы, но explicit лучше
 * implicit для денежного запроса, C11). Только `SELECT` — джоба сама НЕ мутирует `orders`
 * (мутация — на стороне `apps/api`, через `POST .../system-cancel`, см. JSDoc
 * `system-cancel-order.use-case.ts`).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { UNPAID_ORDER_TIMEOUT_DB_POOL } from './unpaid-order-timeout.constants.js'
import type { ExpiredUnpaidOrder, UnpaidOrderScannerPort } from './unpaid-order-timeout.job.js'

const EXPIRED_UNPAID_ORDERS_QUERY = `
  SELECT id AS order_id, tenant_id
  FROM orders
  WHERE status = 'pending_payment'
    AND payment_window_expires_at IS NOT NULL
    AND payment_window_expires_at <= $1
`

interface ExpiredOrderRow {
  readonly order_id: string
  readonly tenant_id: string
}

@Injectable()
export class PgUnpaidOrderScannerAdapter implements UnpaidOrderScannerPort {
  constructor(@Inject(UNPAID_ORDER_TIMEOUT_DB_POOL) private readonly pool: Pool) {}

  async findExpiredOrders(now: Date): Promise<readonly ExpiredUnpaidOrder[]> {
    const result = await this.pool.query<ExpiredOrderRow>(EXPIRED_UNPAID_ORDERS_QUERY, [now])
    return result.rows.map((row) => ({ orderId: row.order_id, tenantId: row.tenant_id }))
  }
}
