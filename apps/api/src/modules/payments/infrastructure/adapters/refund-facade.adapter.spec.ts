/**
 * `RefundFacadeAdapter` (EP-10, DTJ-245) — unit-тесты на моках (`DrizzleDb`/`RefundOrderUseCase`),
 * без реального Postgres: покрывает ветки маппинга ошибок (`toRefundError`) и «заказ не найден»,
 * которые интеграционный тест (`test/integration/payments/refund-order.integration.spec.ts`)
 * не обязан дублировать целиком (тот же реальный DI-путь уже покрыт там для happy-path/AC1-4).
 *
 * `FakeDrizzleChain` — минимальная фейковая цепочка `select().from().where().limit()`
 * (тот же метод, что использует `resolveTenantId`) — без реального `drizzle-orm`.
 */
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@dorutj/contracts'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import type { RefundOrderUseCase } from '@/modules/payments/application/use-cases/refund-order.use-case.js'
import { RefundFacadeAdapter } from './refund-facade.adapter.js'

function fakeDb(tenantIdRow: { tenantId: string } | undefined): DrizzleDb {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(tenantIdRow === undefined ? [] : [tenantIdRow]),
  }
  return chain as unknown as DrizzleDb
}

function fakeUseCase(execute: (...args: unknown[]) => Promise<void>): RefundOrderUseCase {
  return { execute } as unknown as RefundOrderUseCase
}

describe('RefundFacadeAdapter (DTJ-245)', () => {
  it('happy path — резолвит tenantId, делегирует RefundOrderUseCase.execute, возвращает ok(undefined)', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const adapter = new RefundFacadeAdapter(fakeDb({ tenantId: 'tenant-1' }), fakeUseCase(execute))

    const result = await adapter.refundFull('order-1', 'customer_changed_mind')

    expect(result).toEqual({ ok: true, value: undefined })
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'order-1', reason: 'customer_changed_mind' })
  })

  it('заказ не найден (пустой SELECT) → Err(PAYMENT_PROVIDER_UNAVAILABLE), RefundOrderUseCase.execute НЕ вызван', async () => {
    const execute = vi.fn()
    const adapter = new RefundFacadeAdapter(fakeDb(undefined), fakeUseCase(execute))

    const result = await adapter.refundFull('order-missing', 'customer_changed_mind')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)
      expect(result.error.message).toMatch(/not found/)
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('RefundOrderUseCase.execute бросает PaymentProviderError(TIMEOUT) → Err(SERVICE_UNAVAILABLE)', async () => {
    const timeoutError = new PaymentProviderError('TIMEOUT', 'PaymentProvider.refund timed out')
    const execute = vi.fn().mockRejectedValue(timeoutError)
    const adapter = new RefundFacadeAdapter(fakeDb({ tenantId: 'tenant-1' }), fakeUseCase(execute))

    const result = await adapter.refundFull('order-1', 'customer_changed_mind')

    expect(result).toEqual({ ok: false, error: { code: ErrorCode.SERVICE_UNAVAILABLE, message: timeoutError.message } })
  })

  it('RefundOrderUseCase.execute бросает НЕ-таймаут PaymentProviderError → Err(PAYMENT_PROVIDER_UNAVAILABLE)', async () => {
    const bankError = new PaymentProviderError('BANK_REQUEST_FAILED', 'HTTP 502')
    const execute = vi.fn().mockRejectedValue(bankError)
    const adapter = new RefundFacadeAdapter(fakeDb({ tenantId: 'tenant-1' }), fakeUseCase(execute))

    const result = await adapter.refundFull('order-1', 'customer_changed_mind')

    expect(result).toEqual({ ok: false, error: { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: bankError.message } })
  })

  it('RefundOrderUseCase.execute бросает произвольный Error → Err(PAYMENT_PROVIDER_UNAVAILABLE) с тем же message', async () => {
    const genericError = new Error('unexpected failure')
    const execute = vi.fn().mockRejectedValue(genericError)
    const adapter = new RefundFacadeAdapter(fakeDb({ tenantId: 'tenant-1' }), fakeUseCase(execute))

    const result = await adapter.refundFull('order-1', 'customer_changed_mind')

    expect(result).toEqual({ ok: false, error: { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: 'unexpected failure' } })
  })
})
