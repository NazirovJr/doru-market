/**
 * Unit-тест `HandlePaymentWebhookUseCase` (EP-10, DTJ-242, тест-план тикета) — все порты
 * замоканы (`application`-слой не знает о реальной инфраструктуре, `02` §3). Интеграционные
 * ACs 1-5 против РЕАЛЬНОГО Postgres — `test/integration/payments/handle-payment-webhook.
 * integration.spec.ts`; здесь — оркестрация, порядок операций и границы транзакции.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { BankWebhookVerifierPort, VerifiedWebhookPayload } from '@/modules/payments/application/ports/bank-webhook-verifier.port.js'
import type {
  OriginalPaymentOperationRef,
  RecordWebhookEventInput,
} from '@/modules/payments/application/ports/payment-webhook-operations.port.js'
import type { EscrowLedgerRepository } from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import type { PaymentsOrderSnapshot, PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'
import type { PaymentsUnitOfWorkPort } from '@/modules/payments/application/ports/payments-unit-of-work.port.js'
import { InvalidWebhookSignatureError } from '@dorutj/contracts'
import { HandlePaymentWebhookUseCase } from './handle-payment-webhook.use-case.js'
import { WebhookProviderUnknownError } from './errors/webhook-provider-unknown.error.js'

const TX_MARKER: PaymentsUnitOfWorkTx = { marker: 'tx' }

function makePayload(overrides: Partial<VerifiedWebhookPayload> = {}): VerifiedWebhookPayload {
  return {
    bankEventId: 'evt-1',
    providerRef: 'mock_inv_1',
    type: 'payment_confirmed',
    amountDiram: 15_000n,
    occurredAt: new Date('2026-09-03T10:00:00Z'),
    ...overrides,
  }
}

function makeOrderSnapshot(overrides: Partial<PaymentsOrderSnapshot> = {}): PaymentsOrderSnapshot {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    status: 'pending_payment',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: 15_000n,
    pharmacyChainId: null,
    ...overrides,
  }
}

function buildHarness() {
  const verifier = { verify: vi.fn() }
  const registry = { resolve: vi.fn<(providerName: string) => BankWebhookVerifierPort | null>(() => verifier) }
  const webhookOperations = {
    findOrderByProviderRef: vi.fn<(providerRef: string, tx?: PaymentsUnitOfWorkTx) => Promise<OriginalPaymentOperationRef | null>>(),
    recordEventIfNew: vi.fn<(input: RecordWebhookEventInput, tx: PaymentsUnitOfWorkTx) => Promise<boolean>>(),
  }
  const ledgerRepository = { append: vi.fn() }
  const ordersPort = { getOrderById: vi.fn(), markPaidEscrow: vi.fn(), cancel: vi.fn() }
  const outbox = { append: vi.fn() }
  const unitOfWork: PaymentsUnitOfWorkPort = { run: (cb) => cb(TX_MARKER) }
  const logger = { warn: vi.fn() }

  const useCase = new HandlePaymentWebhookUseCase(
    registry,
    webhookOperations,
    ledgerRepository as unknown as EscrowLedgerRepository,
    ordersPort,
    outbox,
    unitOfWork,
    logger as unknown as Logger,
  )
  return { useCase, verifier, registry, webhookOperations, ledgerRepository, ordersPort, outbox, logger }
}

describe('HandlePaymentWebhookUseCase', () => {
  it('AC4 — неизвестный provider → WebhookProviderUnknownError, verify() НИКОГДА не вызывается', async () => {
    const h = buildHarness()
    h.registry.resolve.mockReturnValue(null)

    await expect(h.useCase.execute(Buffer.from('{}'), {}, 'unknown_bank')).rejects.toBeInstanceOf(WebhookProviderUnknownError)

    expect(h.verifier.verify).not.toHaveBeenCalled()
    expect(h.webhookOperations.findOrderByProviderRef).not.toHaveBeenCalled()
  })

  it('AC3 / порядок verify→parse — невалидная подпись бросает СРАЗУ (даже если тело физически невалидный JSON, verify() решает первым)', async () => {
    const h = buildHarness()
    const signatureError = new InvalidWebhookSignatureError({ provider: 'mock_bank' })
    h.verifier.verify.mockReturnValue({ ok: false, error: signatureError })

    await expect(h.useCase.execute(Buffer.from('not even json {{{'), {}, 'mock_bank')).rejects.toBe(signatureError)

    expect(h.webhookOperations.findOrderByProviderRef).not.toHaveBeenCalled()
    expect(h.webhookOperations.recordEventIfNew).not.toHaveBeenCalled()
    expect(h.ordersPort.markPaidEscrow).not.toHaveBeenCalled()
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ providerName: 'mock_bank' }), 'payments.webhook.invalid_signature')
  })

  it('providerRef неизвестен (SRS-PAY-028, defensive) — 200-эквивалент, без транзакции/мутации', async () => {
    const h = buildHarness()
    h.verifier.verify.mockReturnValue({ ok: true, value: makePayload() })
    h.webhookOperations.findOrderByProviderRef.mockResolvedValue(null)

    await h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank')

    expect(h.webhookOperations.recordEventIfNew).not.toHaveBeenCalled()
    expect(h.ordersPort.markPaidEscrow).not.toHaveBeenCalled()
    expect(h.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ providerRef: 'mock_inv_1' }), 'payments.webhook.unknown_provider_ref')
  })

  it('AC2 — recordEventIfNew возвращает false (дубликат) → markPaidEscrow/ledger/outbox НЕ вызываются', async () => {
    const h = buildHarness()
    const payload = makePayload()
    h.verifier.verify.mockReturnValue({ ok: true, value: payload })
    const original: OriginalPaymentOperationRef = { orderId: 'order-1', tenantId: 'tenant-1' }
    h.webhookOperations.findOrderByProviderRef.mockResolvedValue(original)
    h.webhookOperations.recordEventIfNew.mockResolvedValue(false)

    await h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank')

    expect(h.webhookOperations.recordEventIfNew).toHaveBeenCalledTimes(1)
    expect(h.ordersPort.getOrderById).not.toHaveBeenCalled()
    expect(h.ordersPort.markPaidEscrow).not.toHaveBeenCalled()
    expect(h.ledgerRepository.append).not.toHaveBeenCalled()
    expect(h.outbox.append).not.toHaveBeenCalled()
  })

  it('AC1 — happy path: recordEventIfNew(true) → getOrderById(tx) → markPaidEscrow(tx) → ledger.append(tx) → outbox.append(tx), ВСЕ с ОДНИМ tx', async () => {
    const h = buildHarness()
    const payload = makePayload()
    h.verifier.verify.mockReturnValue({ ok: true, value: payload })
    h.webhookOperations.findOrderByProviderRef.mockResolvedValue({ orderId: 'order-1', tenantId: 'tenant-1' })
    h.webhookOperations.recordEventIfNew.mockResolvedValue(true)
    h.ordersPort.getOrderById.mockResolvedValue(makeOrderSnapshot())
    h.ordersPort.markPaidEscrow.mockResolvedValue(undefined)
    h.ledgerRepository.append.mockResolvedValue(undefined)
    h.outbox.append.mockResolvedValue(undefined)

    await h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank')

    const recordArgs = h.webhookOperations.recordEventIfNew.mock.calls[0] as [RecordWebhookEventInput, PaymentsUnitOfWorkTx]
    expect(recordArgs[0]).toMatchObject({ bankEventId: 'evt-1', orderId: 'order-1', operationType: 'payment_confirmed', succeeded: true })
    expect(recordArgs[1]).toBe(TX_MARKER)

    expect(h.ordersPort.getOrderById).toHaveBeenCalledWith('tenant-1', 'order-1', TX_MARKER)
    expect(h.ordersPort.markPaidEscrow).toHaveBeenCalledWith('tenant-1', 'order-1', 'mock_inv_1', payload.occurredAt, TX_MARKER)

    const ledgerArgs = h.ledgerRepository.append.mock.calls[0] as [{ entryType: string; direction: string; orderId: string }, PaymentsUnitOfWorkTx]
    expect(ledgerArgs[0]).toMatchObject({ entryType: 'hold_created', direction: 'debit', orderId: 'order-1' })
    expect(ledgerArgs[1]).toBe(TX_MARKER)

    const outboxArgs = h.outbox.append.mock.calls[0] as [string, { type: string; paymentMethod: string }, PaymentsUnitOfWorkTx]
    expect(outboxArgs[0]).toBe('tenant-1')
    expect(outboxArgs[1]).toMatchObject({ type: 'OrderPaidEvent', paymentMethod: 'alif_mobi', holdAmountDiram: '15000' })
    expect(outboxArgs[2]).toBe(TX_MARKER)
  })

  it('payment_failed — идемпотентная строка пишется, НО markPaidEscrow/ledger/outbox НЕ вызываются (TODO(DTJ-245), см. JSDoc п.5)', async () => {
    const h = buildHarness()
    const payload = makePayload({ type: 'payment_failed' })
    h.verifier.verify.mockReturnValue({ ok: true, value: payload })
    h.webhookOperations.findOrderByProviderRef.mockResolvedValue({ orderId: 'order-1', tenantId: 'tenant-1' })
    h.webhookOperations.recordEventIfNew.mockResolvedValue(true)

    await h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank')

    const recordArgs = h.webhookOperations.recordEventIfNew.mock.calls[0] as [RecordWebhookEventInput, PaymentsUnitOfWorkTx]
    expect(recordArgs[0].operationType).toBe('payment_failed')
    expect(recordArgs[0].succeeded).toBe(false)
    expect(h.ordersPort.getOrderById).not.toHaveBeenCalled()
    expect(h.ordersPort.markPaidEscrow).not.toHaveBeenCalled()
    expect(h.ledgerRepository.append).not.toHaveBeenCalled()
  })

  it('refund_confirmed — тоже вне SRS-PAY-018 категорического пути этого тикета: идемпотентная строка есть, markPaidEscrow нет', async () => {
    const h = buildHarness()
    const payload = makePayload({ type: 'refund_confirmed' })
    h.verifier.verify.mockReturnValue({ ok: true, value: payload })
    h.webhookOperations.findOrderByProviderRef.mockResolvedValue({ orderId: 'order-1', tenantId: 'tenant-1' })
    h.webhookOperations.recordEventIfNew.mockResolvedValue(true)

    await h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank')

    const recordArgs = h.webhookOperations.recordEventIfNew.mock.calls[0] as [RecordWebhookEventInput, PaymentsUnitOfWorkTx]
    expect(recordArgs[0].succeeded).toBe(true) // refund_confirmed — «успех» операции возврата, не создания hold.
    expect(h.ordersPort.markPaidEscrow).not.toHaveBeenCalled()
  })

  it('order исчез внутри собственной транзакции (defensive) — бросает, не создаёт частичное состояние', async () => {
    const h = buildHarness()
    const payload = makePayload()
    h.verifier.verify.mockReturnValue({ ok: true, value: payload })
    h.webhookOperations.findOrderByProviderRef.mockResolvedValue({ orderId: 'order-1', tenantId: 'tenant-1' })
    h.webhookOperations.recordEventIfNew.mockResolvedValue(true)
    h.ordersPort.getOrderById.mockResolvedValue(null)

    await expect(h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank')).rejects.toThrow('data integrity violation')

    expect(h.ordersPort.markPaidEscrow).not.toHaveBeenCalled()
    expect(h.ledgerRepository.append).not.toHaveBeenCalled()
  })

  it('AC5 — конкурентные вызовы для РАЗНЫХ заказов не сериализуются в самом use case (нет общего мьютекса)', async () => {
    const h = buildHarness()
    let concurrentInFlight = 0
    let sawConcurrency = false
    h.verifier.verify.mockImplementation(() => ({ ok: true, value: makePayload() }))
    h.webhookOperations.findOrderByProviderRef.mockImplementation(async () => {
      concurrentInFlight += 1
      if (concurrentInFlight > 1) sawConcurrency = true
      await new Promise((resolve) => setTimeout(resolve, 10))
      concurrentInFlight -= 1
      return { orderId: 'order-x', tenantId: 'tenant-1' }
    })
    h.webhookOperations.recordEventIfNew.mockResolvedValue(false)

    await Promise.all([
      h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank'),
      h.useCase.execute(Buffer.from('{}'), {}, 'mock_bank'),
    ])

    expect(sawConcurrency).toBe(true)
  })
})
