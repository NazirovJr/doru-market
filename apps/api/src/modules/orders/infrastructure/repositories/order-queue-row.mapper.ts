/**
 * `toQueueRow` (DTJ-301, EP-12, модуль 24 «Терминал фармацевта») — маппинг строки
 * `DrizzleOrderRepository.findQueueOrders` в `OrderQueueRow`. Вынесено из `order.repository.ts`
 * ради `max-lines` (C2, ≤300 строк/файл) — тот же приём, что вынос `order-create-command.ts`/
 * валидаторов из `order.entity.ts` (DTJ-221). Самодостаточный файл (собственные `toDate*`-хелперы,
 * не импортирует их из `order.repository.ts`) — избегает циклического импорта между двумя
 * файлами одного репозитория.
 */
import type { OrderPaymentMethod } from '@dorutj/contracts'
import type { OrderRow } from '@/db/schema/orders.js'
import type { OrderQueueRow } from '@/modules/orders/application/ports/order-repository.port.js'

/** Строка `findQueueOrders` — типы полей 1:1 с `select(...)` в `DrizzleOrderRepository.findQueueOrders`. */
export interface QueueSelectRow {
  readonly id: string
  readonly orderNumber: string
  readonly status: OrderRow['status']
  readonly pharmacyId: string | null
  readonly itemsTotalTjs: string
  readonly paymentMethod: string
  readonly prescriptionId: string | null
  readonly slaDeadlineAt: Date | string | null
  readonly assignedPharmacistId: string | null
  readonly assignedPharmacistName: string | null
  readonly createdAt: Date | string | null
}

/** DTJ-301 — та же защита «испорченная строка падает громко», что `rowToSnapshot` (`order.repository.ts`). */
export function toQueueRow(row: QueueSelectRow, itemsCount: number): OrderQueueRow {
  if (row.status === null) {
    throw new Error(`orders.status is NULL for order ${row.id} (queue projection) — data integrity violation`)
  }
  if (row.pharmacyId === null) {
    throw new Error(`orders.pharmacy_id is NULL for order ${row.id} (queue projection) — data integrity violation`)
  }
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    pharmacyId: row.pharmacyId,
    itemsCount,
    itemsTotalTjs: Number(row.itemsTotalTjs),
    paymentMethod: row.paymentMethod as OrderPaymentMethod,
    prescriptionRequired: row.prescriptionId !== null,
    slaDeadlineAt: toDateOrNull(row.slaDeadlineAt),
    assignedPharmacistId: row.assignedPharmacistId,
    assignedPharmacistName: row.assignedPharmacistName,
    createdAt: toDateOrThrow(row.createdAt, row.id, 'created_at'),
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value)
}

function toDateOrThrow(value: Date | string | null, orderId: string, column: string): Date {
  if (value === null) {
    throw new Error(`orders.${column} is NULL for order ${orderId} — data integrity violation`)
  }
  return toDate(value)
}
