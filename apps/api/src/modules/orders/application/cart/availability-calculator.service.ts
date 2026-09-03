/**
 * `AvailabilityCalculator` (EP-09, DTJ-224, SRS-ORD-005..009).
 *
 * `getAvailableQuantity` = `stockQuantity` (через `InventoryFacadePort`) минус сумма чужих
 * активных мягких холдов (через `CartHoldStorePort`). РЕЗУЛЬТАТ — ТОЛЬКО для показа
 * пользователю (D-EP09-12 §2 `reports/EP09-CTO-BRIEF.md`): он НИКОГДА не условие, запрещающее
 * добавление в корзину или checkout — единственный источник истины по остатку —
 * `InventoryFacade.reserveStock()` внутри `Order.create()` (DTJ-227). Здесь НЕТ ни одного
 * `if (available < quantity) return Err(...)` и не должно появиться.
 *
 * Fail-open (SRS-ORD-008, D-EP09-12 §1): `CartHoldStorePort.getActiveHolds` недоступен
 * (таймаут/обрыв соединения) → возвращается `stockQuantity` БЕЗ вычета холдов, `WARN` в лог,
 * исключение наружу НЕ пробрасывается — деградация кэша холдов не имеет права заблокировать
 * отображение/добавление товара.
 *
 * Клампинг в ноль (D-EP09-12 §4): сумма холдов может превысить остаток после ручной коррекции
 * склада — `Math.max(0, ...)` на ОБЕИХ ветках (обычной и fail-open).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { CART_HOLD_STORE_PORT, type CartHoldStorePort } from '../ports/cart-hold-store.port.js'
import { INVENTORY_FACADE_PORT, type InventoryFacadePort } from '../ports/inventory-facade.port.js'

const MIN_AVAILABLE_QUANTITY = 0

@Injectable()
export class AvailabilityCalculator {
  private readonly logger = new Logger(AvailabilityCalculator.name)

  constructor(
    @Inject(CART_HOLD_STORE_PORT) private readonly cartHoldStore: CartHoldStorePort,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
  ) {}

  async getAvailableQuantity(pharmacyId: string, medicineId: string, excludeCartItemId?: string): Promise<number> {
    const stockQuantity = await this.inventoryFacade.getStockQuantity(pharmacyId, medicineId)

    let activeHolds: number
    try {
      activeHolds = await this.cartHoldStore.getActiveHolds(pharmacyId, medicineId, excludeCartItemId)
    } catch (error: unknown) {
      this.logger.warn(
        `cart_hold_store_unavailable — fail-open до stockQuantity (SRS-ORD-008): ${String(error)}`,
      )
      return Math.max(MIN_AVAILABLE_QUANTITY, stockQuantity)
    }
    return Math.max(MIN_AVAILABLE_QUANTITY, stockQuantity - activeHolds)
  }
}
