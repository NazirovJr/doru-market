/**
 * Unit-тесты `LatePaymentRefundService` (EP-10, DTJ-243, SRS-PAY-027) — все порты замоканы.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { ErrorCode } from '@dorutj/contracts'
import type { EscrowLedgerRepository } from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import type { PaymentProvider, RefundRef } from '@/modules/payments/application/ports/payment-provider.port.js'
import type { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import type { SupportTicketPort } from '@/modules/payments/application/ports/support-ticket.port.js'
import type { PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'
import { LatePaymentRefundService, type LatePaymentRefundInput } from './late-payment-refund.service.js'

const TX_MARKER: PaymentsUnitOfWorkTx = { marker: 'tx' }
const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

const INPUT: LatePaymentRefundInput = {
  tenantId: 'tenant-1',
  orderId: 'order-1',
  amountDiram: 10_000n,
  providerRef: 'mock_inv_late_1',
}

const DEFAULT_REFUND_RESULT: Result<RefundRef, PaymentProviderError> = ok({
  providerRefundRef: 'mock_refund_1',
  amountDiram: 10_000n,
  status: 'succeeded',
})

function buildHarness(refundResult: Result<RefundRef, PaymentProviderError> = DEFAULT_REFUND_RESULT) {
  const append = vi.fn<EscrowLedgerRepository['append']>().mockResolvedValue(undefined)
  const ledgerRepository = { append } as unknown as EscrowLedgerRepository
  const refund = vi.fn<PaymentProvider['refund']>().mockResolvedValue(refundResult)
  const paymentProvider = { refund } as unknown as PaymentProvider
  const createSystemAutoTicket = vi.fn<SupportTicketPort['createSystemAutoTicket']>().mockResolvedValue({ ticketId: 'ticket-1' })
  const supportTickets = { createSystemAutoTicket } as unknown as SupportTicketPort
  const service = new LatePaymentRefundService(ledgerRepository, paymentProvider, supportTickets, SILENT_LOGGER)
  return { service, append, refund, createSystemAutoTicket }
}

describe('LatePaymentRefundService (DTJ-243)', () => {
  it('happy path: hold_created → PaymentProvider.refund → refunded_to_customer → support_ticket, все с providerRef исходного платежа', async () => {
    const h = buildHarness()

    await h.service.handle(INPUT, TX_MARKER)

    expect(h.append).toHaveBeenCalledTimes(2)
    const [holdEntry, holdTx] = h.append.mock.calls[0]!
    expect(holdEntry).toMatchObject({ orderId: 'order-1', entryType: 'hold_created', direction: 'debit' })
    expect(holdTx).toBe(TX_MARKER)
    const [refundEntry, refundTx] = h.append.mock.calls[1]!
    expect(refundEntry).toMatchObject({ orderId: 'order-1', entryType: 'refunded_to_customer', direction: 'credit', reason: 'late_payment_after_cancellation' })
    expect(refundTx).toBe(TX_MARKER)

    expect(h.refund).toHaveBeenCalledExactlyOnceWith('mock_inv_late_1', 'late-refund:order-1')
    expect(h.createSystemAutoTicket).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: 'tenant-1', orderId: 'order-1', category: 'payment_issue' }),
    )
  })

  it('hold_created записывается ДО вызова PaymentProvider.refund (порядок операций)', async () => {
    const h = buildHarness()
    const callOrder: string[] = []
    h.append.mockImplementation(() => {
      callOrder.push('append')
      return Promise.resolve()
    })
    h.refund.mockImplementation(() => {
      callOrder.push('refund')
      return Promise.resolve(ok({ providerRefundRef: 'r', amountDiram: 10_000n, status: 'succeeded' }))
    })

    await h.service.handle(INPUT, TX_MARKER)

    expect(callOrder).toEqual(['append', 'refund', 'append'])
  })

  it('PaymentProvider.refund возвращает Err → бросает ошибку провайдера, refunded_to_customer НЕ записывается, support_ticket НЕ создаётся', async () => {
    const providerError: PaymentProviderError = { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message: 'bank down' } as PaymentProviderError
    const h = buildHarness(err(providerError))

    await expect(h.service.handle(INPUT, TX_MARKER)).rejects.toBe(providerError)

    expect(h.append).toHaveBeenCalledTimes(1) // только hold_created
    expect(h.createSystemAutoTicket).not.toHaveBeenCalled()
  })

  it('support_ticket создание падает — НЕ бросает (best-effort), рефанд уже совершён', async () => {
    const h = buildHarness()
    h.createSystemAutoTicket.mockRejectedValue(new Error('db down'))

    await expect(h.service.handle(INPUT, TX_MARKER)).resolves.toBeUndefined()

    expect(h.refund).toHaveBeenCalledOnce()
    expect(h.append).toHaveBeenCalledTimes(2)
  })
})
