/**
 * `checkout.util.ts` (EP-09, DTJ-227/230) — unit-набор для чистых хелперов. Фокус — DTJ-230
 * DoD: «явный тест на TC-ORD-001c-подобный инвариант» (`assertOrderConfirmationInvariant`).
 *
 * Happy-path (`Order.create()` реальным путём) физически не может дойти до `else`-ветки —
 * `Order.create()` (DTJ-221/222) уже гарантирует инвариант конструктивно, а `Order.restore()`
 * (`assertRestoreSnapshotIntegrity`, DTJ-222) отдельно блокирует те же 2 испорченных
 * состояния на восстановлении — оба пути домена физически не производят нарушающий объект.
 * Ветки-нарушения тестируются на МИНИМАЛЬНОМ объекте той же формы, приведённом к `Order`
 * (`as unknown as Order`, только для теста этой конкретной defense-in-depth assertion, не
 * домена) — сам факт, что домен недостижим сюда, ПОДТВЕРЖДАЕТ, что `Order` не может
 * произвести это состояние; эта assertion — страховка НА СЛУЧАЙ будущего рефакторинга домена.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order as RealOrder } from '@/modules/orders/domain/order.entity.js'
import type { PharmacyGroup } from '@/modules/orders/application/cart/split-cart-by-pharmacy.use-case.js'
import {
  assertOrderConfirmationInvariant,
  buildCostInputItems,
  buildItemCommands,
  InvariantViolationError,
  withTimeout,
} from './checkout.util.js'

const IMMEDIATE_ID_GENERATOR = { next: () => randomUUID() }

function pharmacyGroup(medicineIds: readonly string[]): PharmacyGroup {
  return {
    pharmacyId: 'pharmacy-1',
    pharmacyName: null,
    subtotalDiram: 0n,
    items: medicineIds.map((medicineId) => ({
      medicineId,
      pharmacyId: 'pharmacy-1',
      pharmacyName: null,
      quantity: 1,
      unitPriceDiram: 100n,
    })),
  }
}

function fakeOrder(paymentMethod: 'cash_courier' | 'alif_mobi', status: string): Order {
  return { id: randomUUID(), paymentMethod, status } as unknown as Order
}

describe('assertOrderConfirmationInvariant (DTJ-230, D-25/D-EP09-35)', () => {
  it('happy path — cash_courier + confirmed (реальный Order.create()) — не бросает', () => {
    const created = RealOrder.create(validOrderCreateCommand({ paymentMethod: 'cash_courier' }))
    if (!created.ok) throw new Error('fixture: expected Order.create() to succeed')
    expect(() => { assertOrderConfirmationInvariant(created.value) }).not.toThrow()
  })

  it('happy path — non-cash + pending_payment (реальный Order.create()) — не бросает', () => {
    const created = RealOrder.create(validOrderCreateCommand({ paymentMethod: 'alif_mobi' }))
    if (!created.ok) throw new Error('fixture: expected Order.create() to succeed')
    expect(() => { assertOrderConfirmationInvariant(created.value) }).not.toThrow()
  })

  it('нарушение — cash_courier, но status !== confirmed → InvariantViolationError (НЕ DomainError)', () => {
    const broken = fakeOrder('cash_courier', 'pending_payment')
    expect(() => { assertOrderConfirmationInvariant(broken) }).toThrow(InvariantViolationError)
  })

  it('нарушение — non-cash, но status === confirmed → InvariantViolationError', () => {
    const broken = fakeOrder('alif_mobi', 'confirmed')
    expect(() => { assertOrderConfirmationInvariant(broken) }).toThrow(InvariantViolationError)
  })

  it('InvariantViolationError — НЕ DomainError (не мапится в 4xx AllExceptionsFilter, падает 500)', () => {
    const broken = fakeOrder('cash_courier', 'paid_escrow')
    try {
      assertOrderConfirmationInvariant(broken)
      throw new Error('expected assertOrderConfirmationInvariant to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(InvariantViolationError)
      expect(error).toBeInstanceOf(Error)
      expect((error as { code?: unknown }).code).toBeUndefined() // DomainError несёт .code, эта ошибка — нет
    }
  })
})

describe('buildItemCommands / buildCostInputItems — контракт адаптера (defense-in-depth)', () => {
  it('buildItemCommands — reservedLines не покрывает позицию группы → Error (adapter contract violation)', () => {
    const group = pharmacyGroup(['med-1'])
    expect(() =>
      buildItemCommands({ group, snapshots: new Map(), reservedLines: [], idGenerator: IMMEDIATE_ID_GENERATOR, commissionByMedicine: new Map() }),
    ).toThrow(/adapter contract violation/)
  })

  it('buildItemCommands — commissionByMedicine не покрывает позицию → Error (DTJ-228 contract violation)', () => {
    const group = pharmacyGroup(['med-1'])
    const reservedLines = [{ medicineId: 'med-1', inventoryBatchId: 'batch-1', quantity: 1, unitPriceDiram: 100n }]
    expect(() =>
      buildItemCommands({ group, snapshots: new Map(), reservedLines, idGenerator: IMMEDIATE_ID_GENERATOR, commissionByMedicine: new Map() }),
    ).toThrow(/CalculateOrderCostService did not return a commission line/)
  })

  it('buildCostInputItems — reservedLines не покрывает позицию группы → Error (adapter contract violation)', () => {
    const group = pharmacyGroup(['med-1'])
    expect(() => buildCostInputItems(group, [], new Map())).toThrow(/adapter contract violation/)
  })
})

describe('withTimeout', () => {
  it('промис резолвится ДО таймаута → возвращает значение, таймер очищен', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok')
  })

  it('промис отклоняется с Error ДО таймаута → пробрасывает ту же ошибку', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000)).rejects.toThrow('boom')
  })

  it('промис отклоняется НЕ-Error значением → оборачивает в Error(String(value))', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- намеренно не-Error, тестирует именно эту ветку `withTimeout`
    await expect(withTimeout(Promise.reject('non-error-rejection'), 1_000)).rejects.toThrow('non-error-rejection')
  })
})
