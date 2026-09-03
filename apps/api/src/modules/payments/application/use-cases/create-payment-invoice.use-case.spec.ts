/**
 * Unit-тесты `CreatePaymentInvoiceUseCase` (EP-10, DTJ-241) — `PaymentProvider`/
 * `PaymentInvoiceCacheRepositoryPort` замоканы (`vi.fn()`, отдельные переменные — не
 * `provider.createInvoice`/`cache.findCached` — `@typescript-eslint/unbound-method`, тот же
 * приём, что `cancel-order.use-case.spec.ts`), без БД/сети. Интеграционное доказательство
 * идемпотентности (в т.ч. реальной конкурентности `Promise.all`) — отдельно,
 * `test/integration/payments/create-payment-invoice.integration.spec.ts` (тест-план тикета
 * требует именно интеграционный прогон против реального Postgres для ON CONFLICT — JSDoc там же).
 */
import { describe, expect, it, vi } from 'vitest'
import { AppConfigService } from '@/config/app-config.service.js'
import type { ConfigService } from '@nestjs/config'
import type { EnvConfig } from '@/config/env.schema.js'
import type { CachedInvoiceRecord, PaymentInvoiceCacheRepositoryPort } from '../ports/payment-invoice-cache.port.js'
import type { CreateInvoiceCommand, InvoiceRef, PaymentProvider } from '../ports/payment-provider.port.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import { CreatePaymentInvoiceUseCase } from './create-payment-invoice.use-case.js'

function fakeConfig(timeoutMs: number): AppConfigService {
  const env: Partial<EnvConfig> = { PAYMENT_PROVIDER_TIMEOUT_MS: timeoutMs }
  const configService = { get: (key: keyof EnvConfig) => env[key] } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

const CMD: CreateInvoiceCommand = {
  orderId: 'order-1',
  amountDiram: 5_000n,
  currency: 'TJS',
  idempotencyKey: 'key-1',
  description: 'test',
  customerPhone: '+992900000000',
}

const INVOICE: InvoiceRef = { providerRef: 'mock_inv_x', qrPayload: 'mock://pay/mock_inv_x', expiresAt: new Date('2026-01-01T00:15:00Z') }

type CreateInvoiceMock = ReturnType<typeof vi.fn<PaymentProvider['createInvoice']>>
type FindCachedMock = ReturnType<typeof vi.fn<PaymentInvoiceCacheRepositoryPort['findCached']>>
type BackfillMock = ReturnType<typeof vi.fn<PaymentInvoiceCacheRepositoryPort['backfill']>>

function fakeProvider(overrides: { createInvoice?: CreateInvoiceMock } = {}): PaymentProvider {
  return {
    capabilities: vi.fn(),
    createInvoice: overrides.createInvoice ?? vi.fn(),
    getStatus: vi.fn(),
    refund: vi.fn(),
    partialRefund: vi.fn(),
  }
}

/** Объект-параметр (C5, `max-params` ≤3) — два независимых `vi.fn()` одного тестового двойника кэша. */
function fakeCache(overrides: { findCached?: FindCachedMock; backfill?: BackfillMock } = {}): PaymentInvoiceCacheRepositoryPort {
  return {
    findCached: overrides.findCached ?? vi.fn<PaymentInvoiceCacheRepositoryPort['findCached']>().mockResolvedValue(null),
    backfill: overrides.backfill ?? vi.fn(),
  }
}

describe('CreatePaymentInvoiceUseCase (DTJ-241)', () => {
  it('кэш пуст → вызывает provider.createInvoice ровно один раз, бэкфиллит кэш, возвращает InvoiceRef', async () => {
    const createInvoice = vi.fn<PaymentProvider['createInvoice']>().mockResolvedValue({ ok: true, value: INVOICE })
    const findCached = vi.fn<PaymentInvoiceCacheRepositoryPort['findCached']>().mockResolvedValue(null)
    const backfill = vi.fn<PaymentInvoiceCacheRepositoryPort['backfill']>().mockResolvedValue(undefined)
    const useCase = new CreatePaymentInvoiceUseCase(fakeProvider({ createInvoice }), fakeCache({ findCached, backfill }), fakeConfig(8_000))

    const result = await useCase.execute(CMD)

    expect(result).toEqual(INVOICE)
    expect(findCached).toHaveBeenCalledWith(CMD.idempotencyKey)
    expect(createInvoice).toHaveBeenCalledTimes(1)
    expect(createInvoice).toHaveBeenCalledWith(CMD)
    expect(backfill).toHaveBeenCalledWith(CMD.idempotencyKey, INVOICE)
  })

  it('SRS-PAY-003 — кэш найден (полностью завершённая предыдущая попытка) → provider.createInvoice НЕ вызывается', async () => {
    const cached: CachedInvoiceRecord = INVOICE
    const createInvoice = vi.fn<PaymentProvider['createInvoice']>()
    const backfill = vi.fn<PaymentInvoiceCacheRepositoryPort['backfill']>()
    const useCase = new CreatePaymentInvoiceUseCase(
      fakeProvider({ createInvoice }),
      fakeCache({ findCached: vi.fn<PaymentInvoiceCacheRepositoryPort['findCached']>().mockResolvedValue(cached), backfill }),
      fakeConfig(8_000),
    )

    const result = await useCase.execute(CMD)

    expect(result).toEqual(INVOICE)
    expect(createInvoice).not.toHaveBeenCalled()
    expect(backfill).not.toHaveBeenCalled()
  })

  it('provider возвращает Err → пробрасывает ошибку провайдера (не проглатывает), кэш НЕ бэкфиллится', async () => {
    const providerError = new PaymentProviderError('BANK_REQUEST_FAILED', 'HTTP 502')
    const createInvoice = vi.fn<PaymentProvider['createInvoice']>().mockResolvedValue({ ok: false, error: providerError })
    const backfill = vi.fn<PaymentInvoiceCacheRepositoryPort['backfill']>()
    const useCase = new CreatePaymentInvoiceUseCase(fakeProvider({ createInvoice }), fakeCache({ backfill }), fakeConfig(8_000))

    await expect(useCase.execute(CMD)).rejects.toBe(providerError)
    expect(backfill).not.toHaveBeenCalled()
  })

  it('provider зависает дольше PAYMENT_PROVIDER_TIMEOUT_MS → бросает PaymentProviderError(TIMEOUT)', async () => {
    // Никогда не резолвится — таймаут use case'а обязан сработать первым.
    const neverResolves = new Promise<never>(() => undefined)
    const createInvoice = vi.fn<PaymentProvider['createInvoice']>().mockReturnValue(neverResolves)
    const useCase = new CreatePaymentInvoiceUseCase(fakeProvider({ createInvoice }), fakeCache(), fakeConfig(10))

    await expect(useCase.execute(CMD)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})
