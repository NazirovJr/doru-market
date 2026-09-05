/**
 * Тест `AvailabilityCalculator` (EP-09, DTJ-224). Каждый кейс — один критерий приёмки тикета
 * плюс клампинг в ноль (D-EP09-12 §4). Моки `CartHoldStorePort`/`InventoryFacadePort` — тест-план
 * тикета: «на моке CartHoldStorePort, включая fail-open ветку (мок бросает ошибку)».
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { CartHoldStorePort } from '@/modules/orders/application/ports/cart-hold-store.port.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import { AvailabilityCalculator } from './availability-calculator.service.js'

const PHARMACY_ID = randomUUID()
const MEDICINE_ID = randomUUID()
const CART_ITEM_ID = randomUUID()

function setUp(stockQuantity: number) {
  const getActiveHoldsMock = vi.fn<CartHoldStorePort['getActiveHolds']>()
  const cartHoldStore: CartHoldStorePort = {
    hold: vi.fn(),
    extend: vi.fn(),
    getActiveHolds: getActiveHoldsMock,
  }
  const getStockQuantityMock = vi.fn<InventoryFacadePort['getStockQuantity']>().mockResolvedValue(stockQuantity)
  const inventoryFacade: InventoryFacadePort = {
    reserveStock: vi.fn(),
    releaseStock: vi.fn(),
    hasExpiredReservedBatch: vi.fn(),
    getStockQuantity: getStockQuantityMock,
    reserveForOrder: vi.fn(),
    reconcileZeroStock: vi.fn(),
  }
  const calculator = new AvailabilityCalculator(cartHoldStore, inventoryFacade)
  return { calculator, getActiveHoldsMock, getStockQuantityMock }
}

describe('AvailabilityCalculator', () => {
  it('AC1: stockQuantity=5, чужой активный холд=3, без исключения → 2', async () => {
    const { calculator, getActiveHoldsMock } = setUp(5)
    getActiveHoldsMock.mockResolvedValue(3)

    const available = await calculator.getAvailableQuantity(PHARMACY_ID, MEDICINE_ID)

    expect(available).toBe(2)
  })

  it('AC2: тот же холд принадлежит ТЕКУЩЕМУ cartItemId → excludeCartItemId исключает его, доступность = stockQuantity (5)', async () => {
    const { calculator, getActiveHoldsMock } = setUp(5)
    // Порт САМ вычитает excludeCartItemId из суммы (JSDoc CartHoldStorePort.getActiveHolds) —
    // мок отражает это поведение: при exclude свой холд не в сумме.
    getActiveHoldsMock.mockImplementation((_pharmacyId, _medicineId, excludeCartItemId) =>
      Promise.resolve(excludeCartItemId === CART_ITEM_ID ? 0 : 3),
    )

    const available = await calculator.getAvailableQuantity(PHARMACY_ID, MEDICINE_ID, CART_ITEM_ID)

    expect(available).toBe(5)
    expect(getActiveHoldsMock).toHaveBeenCalledWith(PHARMACY_ID, MEDICINE_ID, CART_ITEM_ID)
  })

  it('AC3: истёкший холд не учитывается портом (getActiveHolds уже вернул сумму БЕЗ него) — пересчёт корректен', async () => {
    const { calculator, getActiveHoldsMock } = setUp(5)
    // TTL истёк на стороне Redis (EXPIRE) — порт возвращает 0, будто холда не было.
    getActiveHoldsMock.mockResolvedValue(0)

    const available = await calculator.getAvailableQuantity(PHARMACY_ID, MEDICINE_ID)

    expect(available).toBe(5)
  })

  it('AC4: CartHoldStorePort.getActiveHolds бросает (Redis недоступен) → fail-open до stockQuantity, БЕЗ исключения наружу', async () => {
    const { calculator, getActiveHoldsMock } = setUp(5)
    getActiveHoldsMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(calculator.getAvailableQuantity(PHARMACY_ID, MEDICINE_ID)).resolves.toBe(5)
  })

  it('D-EP09-12 §4: холды превышают остаток после ручной коррекции склада → клампинг в 0, не отрицательное', async () => {
    const { calculator, getActiveHoldsMock } = setUp(2)
    getActiveHoldsMock.mockResolvedValue(5)

    await expect(calculator.getAvailableQuantity(PHARMACY_ID, MEDICINE_ID)).resolves.toBe(0)
  })

  it('D-EP09-12 §4: fail-open ветка тоже клампится в 0 (stockQuantity сам по себе не может быть < 0, но защищаемся)', async () => {
    const { calculator, getActiveHoldsMock } = setUp(0)
    getActiveHoldsMock.mockRejectedValue(new Error('timeout'))

    await expect(calculator.getAvailableQuantity(PHARMACY_ID, MEDICINE_ID)).resolves.toBe(0)
  })

  it('вызывает InventoryFacadePort.getStockQuantity с (pharmacyId, medicineId)', async () => {
    const { calculator, getActiveHoldsMock, getStockQuantityMock } = setUp(5)
    getActiveHoldsMock.mockResolvedValue(0)

    await calculator.getAvailableQuantity(PHARMACY_ID, MEDICINE_ID)

    expect(getStockQuantityMock).toHaveBeenCalledWith(PHARMACY_ID, MEDICINE_ID)
  })
})
