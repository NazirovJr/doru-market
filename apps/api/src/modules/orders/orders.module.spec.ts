/**
 * Тест заглушек `orders.module.ts` (D-EP09-16, `reports/EP09-CTO-BRIEF.md`, решение CTO).
 * «Чтение-разрешение» (ответ на вопрос «можно ли») не имеет безопасного дефолта — заглушка
 * обязана бросать, как запись, а не возвращать правдоподобное `true`/`false`. Юнит на факт
 * броска — единственное, что требует CTO (доработка тикета DTJ-225).
 */
import { describe, expect, it } from 'vitest'
import {
  UnimplementedDeliveryFacadeAdapter,
  UnimplementedInventoryFacadeAdapter,
  UnimplementedOnboardingFacadeAdapter,
  UnimplementedPrescriptionsFacadeAdapter,
} from './orders.module.js'

describe('UnimplementedInventoryFacadeAdapter (D-EP09-16)', () => {
  it('hasExpiredReservedBatch — чтение-разрешение — бросает, НЕ возвращает false (обошло бы REQ-REG-6)', async () => {
    const adapter = new UnimplementedInventoryFacadeAdapter()
    await expect(adapter.hasExpiredReservedBatch('order-1')).rejects.toThrow()
  })

  it('getStockQuantity — чтение данных — по-прежнему безопасный дефолт 0, не бросает', async () => {
    const adapter = new UnimplementedInventoryFacadeAdapter()
    await expect(adapter.getStockQuantity('pharmacy-1', 'medicine-1')).resolves.toBe(0)
  })

  it('reserveStock/releaseStock/reserveForOrder/reconcileZeroStock — запись — по-прежнему бросают', async () => {
    const adapter = new UnimplementedInventoryFacadeAdapter()
    await expect(adapter.reserveStock('pharmacy-1', [])).rejects.toThrow()
    await expect(adapter.releaseStock([])).rejects.toThrow()
    await expect(adapter.reserveForOrder('pharmacy-1', 'medicine-1', 'L1', 1)).rejects.toThrow()
    await expect(adapter.reconcileZeroStock('medicine-1', 'batch-1')).rejects.toThrow()
  })
})

describe('UnimplementedOnboardingFacadeAdapter (D-EP09-16)', () => {
  it('isPharmacyActive — чтение-разрешение — бросает, НЕ возвращает true (обошло бы SRS-DOM-012/PharmacySuspendedError)', async () => {
    const adapter = new UnimplementedOnboardingFacadeAdapter()
    await expect(adapter.isPharmacyActive('pharmacy-1')).rejects.toThrow()
  })

  it('getPharmacyNames — чтение данных — по-прежнему безопасный дефолт: пустая Map, не бросает', async () => {
    const adapter = new UnimplementedOnboardingFacadeAdapter()
    await expect(adapter.getPharmacyNames()).resolves.toEqual(new Map())
  })
})

describe('UnimplementedDeliveryFacadeAdapter (DTJ-228)', () => {
  it('calculateFee — бросает, не «правдоподобный 0» (не вызывается в проде сегодня, см. JSDoc)', async () => {
    const adapter = new UnimplementedDeliveryFacadeAdapter()
    await expect(adapter.calculateFee()).rejects.toThrow()
  })
})

describe('UnimplementedPrescriptionsFacadeAdapter (DTJ-230, D-EP09-16)', () => {
  it('isVerifiedFor — чтение-разрешение — бросает, НЕ false (false «изобразил» бы отказ, которого никто не выносил)', async () => {
    const adapter = new UnimplementedPrescriptionsFacadeAdapter()
    await expect(adapter.isVerifiedFor()).rejects.toThrow()
  })
})
