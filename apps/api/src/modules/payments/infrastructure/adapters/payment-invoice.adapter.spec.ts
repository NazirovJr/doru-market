/**
 * Unit-тесты `PaymentInvoiceAdapter` (EP-10, DTJ-241) — маппинг команды/результата между
 * `orders`-контрактом (`PaymentInvoicePort`) и `payments`-use case (`CreatePaymentInvoiceUseCase`),
 * без БД/сети (`CreatePaymentInvoiceUseCase` — мок, отдельная переменная `execute`, не
 * `useCase.execute` — `@typescript-eslint/unbound-method`, тот же приём, что
 * `cancel-order.use-case.spec.ts`).
 */
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@dorutj/contracts'
import { PaymentInvoiceAdapter } from './payment-invoice.adapter.js'
import type { CreatePaymentInvoiceUseCase } from '@/modules/payments/application/use-cases/create-payment-invoice.use-case.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import type { PaymentInvoiceCreateCommand } from '@/modules/orders/index.js'

function fakeUseCase(execute: ReturnType<typeof vi.fn>): CreatePaymentInvoiceUseCase {
  return { execute } as unknown as CreatePaymentInvoiceUseCase
}

const CMD: PaymentInvoiceCreateCommand = {
  orderId: 'order-1',
  amountDiram: 5_000n,
  currency: 'TJS',
  idempotencyKey: 'key-1',
  description: 'DoruTJ order DTJ-260101-00001',
  customerPhone: '+992900000000',
}

describe('PaymentInvoiceAdapter (DTJ-241)', () => {
  it('маппирует CreateInvoiceCommand поле-в-поле в вызов use case, Ok(InvoiceRef) при успехе', async () => {
    const expiresAt = new Date('2026-01-01T00:15:00.000Z')
    const execute = vi.fn().mockResolvedValue({ providerRef: 'mock_inv_x', qrPayload: 'mock://pay/mock_inv_x', expiresAt })
    const adapter = new PaymentInvoiceAdapter(fakeUseCase(execute))

    const result = await adapter.createInvoice(CMD)

    expect(execute).toHaveBeenCalledWith({
      orderId: CMD.orderId,
      amountDiram: CMD.amountDiram,
      currency: CMD.currency,
      idempotencyKey: CMD.idempotencyKey,
      description: CMD.description,
      customerPhone: CMD.customerPhone,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ providerRef: 'mock_inv_x', qrPayload: 'mock://pay/mock_inv_x', expiresAt })
    }
  })

  it('use case бросает PaymentProviderError(TIMEOUT) → Err(SERVICE_UNAVAILABLE), НЕ пробрасывает исключение', async () => {
    const execute = vi.fn().mockRejectedValue(new PaymentProviderError('TIMEOUT', 'timed out after 8000ms'))
    const adapter = new PaymentInvoiceAdapter(fakeUseCase(execute))

    const result = await adapter.createInvoice(CMD)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE)
      expect(result.error.message).toContain('timed out')
    }
  })

  it('use case бросает любую другую ошибку → Err(PAYMENT_PROVIDER_UNAVAILABLE)', async () => {
    const execute = vi.fn().mockRejectedValue(new PaymentProviderError('BANK_REQUEST_FAILED', 'HTTP 502'))
    const adapter = new PaymentInvoiceAdapter(fakeUseCase(execute))

    const result = await adapter.createInvoice(CMD)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)
  })

  it('use case бросает generic Error (не PaymentProviderError) → Err(PAYMENT_PROVIDER_UNAVAILABLE), не проглатывает', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('unexpected'))
    const adapter = new PaymentInvoiceAdapter(fakeUseCase(execute))

    const result = await adapter.createInvoice(CMD)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)
      expect(result.error.message).toBe('unexpected')
    }
  })
})
