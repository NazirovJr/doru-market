/**
 * Порт `ReturnsInventoryPort` (EP-11, DTJ-270, SRS-DOM-053/054, REQ-RET-3/4).
 *
 * Межмодульный фасад `returns → inventory` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2) —
 * ЕДИНСТВЕННЫЙ разрешённый способ, которым `returns` возвращает товар на остаток аптеки после
 * `disposition='restock'`. Прямой импорт `modules/inventory/domain/*`/`modules/inventory/
 * application/*` из `returns` — блокирующее нарушение (`dependency-cruiser`,
 * `no-cross-module-deep-import`). 1:1 паттерн `modules/payments/application/ports/
 * orders-facade.port.ts` (DTJ-236).
 *
 * `disposition` передаётся ПОЛНЫМ значением `return_disposition` (не сужен до литерала
 * `'restock'`) — адаптер DTJ-273 сам решает, мутировать ли остаток: физическое `restock`
 * увеличивает `pharmacy_inventory`, `destroy`/`pending_inspection` — не меняют остаток
 * (товар уже покинул инвентарь при выдаче), но вызов порта остаётся ЕДИНЫМ местом, где use case
 * фиксирует «что произошло с товаром физически» — независимо от исхода, для аудита.
 * Реализация — тонкий адаптер поверх реального `modules/inventory` фасада, добавляется
 * инфраструктурным слоем в DTJ-273 (вне периметра этого тикета).
 */
import type { ReturnsUnitOfWorkTx } from './orders-facade.port.js'

/** DI-токен для провайдера `ReturnsInventoryPort`. */
export const RETURNS_INVENTORY_PORT = Symbol.for('@dorutj/returns/inventory-facade')

/** 1:1 с enum `return_disposition` (`db/schema/enums.schema.ts`) — примитив, не доменный VO чужого модуля. */
export type ReturnsInventoryDisposition = 'restock' | 'destroy' | 'pending_inspection'

export interface ReturnsRestockItem {
  readonly medicineId: string
  readonly inventoryBatchId: string | null
  readonly quantity: number
}

export interface ReturnsInventoryPort {
  restock(
    tenantId: string,
    orderId: string,
    items: readonly ReturnsRestockItem[],
    disposition: ReturnsInventoryDisposition,
    tx?: ReturnsUnitOfWorkTx,
  ): Promise<void>
}
