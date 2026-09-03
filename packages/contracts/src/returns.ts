/**
 * Публичные контракты модуля `returns` (EP-11, DTJ-270) — заготовки DTO, наполняются по мере
 * готовности `DTJ-271` (домен `OrderReturn`) / `DTJ-272` (финансовая политика) / `DTJ-273+`
 * (use case'ы/REST, вне периметра этой волны).
 *
 * `ReturnStatus`/`ReturnReason`/`ReturnDisposition` — 1:1 с БД (`return_status`/`return_reason`/
 * `return_disposition` enum'ы, `db/schema/enums.schema.ts`, `11-database-schema.md`
 * строки 134-142). Денежные поля — целые дирамы (`*Diram`, правило 6 AGENTS.md). Даты —
 * ISO-8601 UTC-строки (граница JSON, конвенция `orders.ts`/`pharmacies-map.ts`).
 */

/** 1:1 с enum `return_status`. `returned_to_pharmacy` — в типе есть, R1 не ведёт в него переходов (D-EP11-4). */
export const RETURN_STATUS_VALUES = [
  'return_requested',
  'return_in_transit',
  'returned_to_pharmacy',
  'return_confirmed',
  'return_rejected',
] as const
export type ReturnStatus = (typeof RETURN_STATUS_VALUES)[number]

/** 1:1 с enum `return_reason`. `undelivered` переадресуется в `SupportFacade`, не создаёт `OrderReturn` (SRS-RET-003). */
export const RETURN_REASON_VALUES = [
  'defect',
  'wrong_item',
  'damaged_packaging',
  'expired_or_near_expiry',
  'undelivered',
  'refused_at_door',
  'undeliverable',
  'customer_dispute_post_delivery',
] as const
export type ReturnReason = (typeof RETURN_REASON_VALUES)[number]

/** 1:1 с enum `return_disposition`. */
export const RETURN_DISPOSITION_VALUES = ['restock', 'destroy', 'pending_inspection'] as const
export type ReturnDisposition = (typeof RETURN_DISPOSITION_VALUES)[number]

/**
 * `OrderReturnDto` (заготовка, DTJ-270) — DTO возврата для presentation-слоя. Поля
 * соответствуют `order_returns` (`11-database-schema.md` Группа F), наполняется/уточняется
 * DTJ-271/273/275 (вне периметра этой волны за пределами DTJ-271/272).
 */
export interface OrderReturnDto {
  readonly id: string
  readonly orderId: string
  readonly status: ReturnStatus
  readonly reason: ReturnReason
  readonly disposition: ReturnDisposition | null
  readonly initiatedBy: string
  readonly courierId: string | null
  readonly courierReturnFeeDiram: number
  readonly packagingIntact: boolean | null
  readonly requestedAt: string
  readonly resolvedAt: string | null
}
