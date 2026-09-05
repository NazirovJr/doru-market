/**
 * `PgPickupSlaOrderScannerAdapter` (DTJ-254, SRS-DOM-092/179, SRS-ORD-035) — единственный
 * `SELECT`, которым джоба находит заказы, просроченные по `pickup_sla + pickup_sla_buffer`.
 * Зеркало `PgUnpaidOrderScannerAdapter` (DTJ-253) — только `SELECT`, джоба сама НЕ мутирует
 * `orders` (мутация — на стороне `apps/api`, через `POST .../system-cancel`).
 *
 * JOIN на `tenant_settings` (а не константа 7+5 минут) — тикет явно требует ПЕР-ТЕНАНТНЫЙ SLA
 * (`tenant_settings.pickup_sla_minutes`/`pickup_sla_buffer_minutes`, УЖЕ в базовой схеме,
 * `migrations/0002_tenants_and_settings.sql`, дефолт 7+5 — проверено перед реализацией, НЕ
 * предположено). `INNER JOIN`, не `LEFT JOIN` — `tenant_settings` 1:1 с `tenants`
 * (`tenant_id UUID PRIMARY KEY REFERENCES tenants(id)`), каждый тенант ОБЯЗАН иметь строку
 * (провизионируется атомарно с тенантом, DTJ-057) — отсутствие строки было бы ошибкой данных, не
 * легальным состоянием «нет лимита», поэтому `INNER JOIN` (молчаливое исключение заказа было бы
 * ХУЖЕ, чем явный ноль строк из-за отсутствующего тенанта).
 *
 * `status IN ('paid_escrow','confirmed')` — ОБЕ ветки D-25 ОДНИМ запросом (симметричное условие,
 * см. JSDoc `pickup-sla-timeout.job.ts`) — статус КАЖДОЙ найденной строки возвращается в
 * `ExpiredPickupOrder.status`, джоба передаёт его ДАЛЬШЕ как `expectedFromStatus`, не выбирает
 * ветку сама.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { PICKUP_SLA_TIMEOUT_DB_POOL } from './pickup-sla-timeout.constants.js'
import type { ExpiredPickupOrder, PickupSlaExpiredStatus, PickupSlaOrderScannerPort } from './pickup-sla-timeout.job.js'

const EXPIRED_PICKUP_ORDERS_QUERY = `
  SELECT o.id AS order_id, o.tenant_id, o.status
  FROM orders o
  JOIN tenant_settings ts ON ts.tenant_id = o.tenant_id
  WHERE o.status IN ('paid_escrow', 'confirmed')
    AND o.processing_started_at IS NULL
    AND o.created_at + (ts.pickup_sla_minutes + ts.pickup_sla_buffer_minutes) * INTERVAL '1 minute' <= $1
`

interface ExpiredPickupOrderRow {
  readonly order_id: string
  readonly tenant_id: string
  readonly status: PickupSlaExpiredStatus
}

@Injectable()
export class PgPickupSlaOrderScannerAdapter implements PickupSlaOrderScannerPort {
  constructor(@Inject(PICKUP_SLA_TIMEOUT_DB_POOL) private readonly pool: Pool) {}

  async findExpiredOrders(now: Date): Promise<readonly ExpiredPickupOrder[]> {
    const result = await this.pool.query<ExpiredPickupOrderRow>(EXPIRED_PICKUP_ORDERS_QUERY, [now])
    return result.rows.map((row) => ({ orderId: row.order_id, tenantId: row.tenant_id, status: row.status }))
  }
}
