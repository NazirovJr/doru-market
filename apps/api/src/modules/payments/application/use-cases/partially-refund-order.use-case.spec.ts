/**
 * `PartiallyRefundOrderUseCase` (EP-12, DTJ-304, SRS-PHT-022, D-10/SRS-DOM-162) — на моках
 * (`PaymentsOrdersPort`/`PaymentProvider`/`EscrowLedgerRepository`), без БД/сети. Тот же приём,
 * что `refund-order.use-case.spec.ts` (DTJ-245) — сестринский use case того же модуля.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { ok, err } from '@dorutj/domain-kernel'
import type { PaymentsOrderSnapshot, PaymentsOrdersPort } from '../ports/orders-facade.port.js'
import type { PaymentProvider, RefundRef } from '../ports/payment-provider.port.js'
import type { EscrowLedgerRepository } from '../ports/escrow-ledger-repository.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import { PartiallyRefundOrderUseCase, type PartiallyRefundOrderCommand } from './partially-refund-order.use-case.js'

const ORDER_ID = 'order-1'
const TENANT_ID = 'tenant-1'
const HOLD_AMOUNT_DIRAM = 40_000n
const REFUND_AMOUNT_DIRAM = 20_000n
const HOLD_PROVIDER_REF = 'mock_inv_original'
const REFUND_PROVIDER_REF = 'mock_refund_x'

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

function snapshot(overrides: Partial<PaymentsOrderSnapshot> = {}): PaymentsOrderSnapshot {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    pharmacyId: 'pharmacy-1',
    status: 'processing',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: HOLD_AMOUNT_DIRAM,
    pharmacyChainId: null,
    items: [],
    billingStrategy: 'single_invoice',
    ...overrides,
  }
}

function holdEntry(overrides: { readonly amountDiram?: bigint; readonly providerRef?: string | null } = {}): EscrowLedgerEntry {
  return EscrowLedgerEntry.create({
    orderId: ORDER_ID,
    entryType: 'hold_created',
    direction: 'debit',
    amountDiram: Money.fromDiram(overrides.amountDiram ?? HOLD_AMOUNT_DIRAM),
    paymentTransactionRef: overrides.providerRef === undefined ? HOLD_PROVIDER_REF : overrides.providerRef,
    reason: null,
    actorUserId: null,
  })
}

interface HarnessOverrides {
  readonly order?: PaymentsOrderSnapshot | null
  readonly alreadyProcessedDiram?: bigint
  readonly holdDiram?: bigint
  readonly holdEntries?: readonly EscrowLedgerEntry[]
  readonly refundResult?: Awaited<ReturnType<PaymentProvider['refund']>>
}

interface Harness {
  readonly useCase: PartiallyRefundOrderUseCase
  readonly getOrderById: ReturnType<typeof vi.fn<PaymentsOrdersPort['getOrderById']>>
  readonly refund: ReturnType<typeof vi.fn<PaymentProvider['refund']>>
  readonly sumByType: ReturnType<typeof vi.fn<EscrowLedgerRepository['sumByType']>>
  readonly findByOrderId: ReturnType<typeof vi.fn<EscrowLedgerRepository['findByOrderId']>>
  readonly append: ReturnType<typeof vi.fn<EscrowLedgerRepository['append']>>
}

function makeHarness(overrides: HarnessOverrides = {}): Harness {
  const orderResolved = overrides.order === undefined ? snapshot() : overrides.order
  const getOrderById = vi.fn<PaymentsOrdersPort['getOrderById']>().mockResolvedValue(orderResolved)
  const ordersPort: PaymentsOrdersPort = { getOrderById, markPaidEscrow: vi.fn(), cancel: vi.fn() }

  const refund = vi
    .fn<PaymentProvider['refund']>()
    .mockResolvedValue(overrides.refundResult ?? ok<RefundRef>({ providerRefundRef: REFUND_PROVIDER_REF, amountDiram: REFUND_AMOUNT_DIRAM, status: 'succeeded' }))
  const paymentProvider: PaymentProvider = {
    capabilities: vi.fn(),
    createInvoice: vi.fn(),
    getStatus: vi.fn(),
    refund,
    partialRefund: vi.fn(),
  }

  const sumByType = vi.fn<EscrowLedgerRepository['sumByType']>().mockImplementation((_tenantId, _orderId, entryType) => {
    if (entryType === 'partially_refunded') return Promise.resolve(overrides.alreadyProcessedDiram ?? 0n)
    if (entryType === 'hold_created') return Promise.resolve(overrides.holdDiram ?? HOLD_AMOUNT_DIRAM)
    return Promise.resolve(0n)
  })
  const findByOrderId = vi.fn<EscrowLedgerRepository['findByOrderId']>().mockResolvedValue([...(overrides.holdEntries ?? [holdEntry()])])
  const append = vi.fn<EscrowLedgerRepository['append']>().mockResolvedValue(undefined)
  const escrowLedger: EscrowLedgerRepository = { append, findByOrderId, sumByType }

  const useCase = new PartiallyRefundOrderUseCase(ordersPort, paymentProvider, escrowLedger, SILENT_LOGGER)
  return { useCase, getOrderById, refund, sumByType, findByOrderId, append }
}

function cmd(overrides: Partial<PartiallyRefundOrderCommand> = {}): PartiallyRefundOrderCommand {
  return { tenantId: TENANT_ID, orderId: ORDER_ID, refundAmountDiram: REFUND_AMOUNT_DIRAM, ...overrides }
}

describe('PartiallyRefundOrderUseCase (DTJ-304)', () => {
  it('single_invoice, hold=40000/refund=20000 → refund() вызван один раз, ДВЕ записи: partially_refunded=20000 + adjustment=20000 (недополученное)', async () => {
    const { useCase, refund, append } = makeHarness()

    await useCase.execute(cmd())

    expect(refund).toHaveBeenCalledExactlyOnceWith(HOLD_PROVIDER_REF, `partial-refund:${ORDER_ID}`)
    expect(append).toHaveBeenCalledTimes(2)
    const [partial] = append.mock.calls[0] ?? []
    expect(partial).toMatchObject({
      orderId: ORDER_ID,
      entryType: 'partially_refunded',
      direction: 'credit',
      paymentTransactionRef: REFUND_PROVIDER_REF,
    })
    expect(partial!.amountDiram.diram).toBe(REFUND_AMOUNT_DIRAM)
    const [adjustment] = append.mock.calls[1] ?? []
    expect(adjustment).toMatchObject({ orderId: ORDER_ID, entryType: 'adjustment', direction: 'credit' })
    expect(adjustment!.amountDiram.diram).toBe(HOLD_AMOUNT_DIRAM - REFUND_AMOUNT_DIRAM)
    expect(adjustment!.reason).not.toBeNull()
    expect(adjustment!.actorUserId).not.toBeNull()
  })

  it('refundAmountDiram === holdAmount (все позиции unavailable) → БЕЗ adjustment-записи (Money запрещает 0)', async () => {
    const { useCase, append } = makeHarness({ holdDiram: REFUND_AMOUNT_DIRAM })

    await useCase.execute(cmd({ refundAmountDiram: REFUND_AMOUNT_DIRAM }))

    expect(append).toHaveBeenCalledTimes(1)
    expect(append.mock.calls[0]?.[0]).toMatchObject({ entryType: 'partially_refunded' })
  })

  it('cash_courier → PaymentProvider.refund НЕ вызван, escrow_ledger не тронут', async () => {
    const { useCase, refund, append, sumByType, findByOrderId } = makeHarness({ order: snapshot({ paymentMethod: 'cash_courier' }) })

    await useCase.execute(cmd())

    expect(refund).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
    expect(sumByType).not.toHaveBeenCalled()
    expect(findByOrderId).not.toHaveBeenCalled()
  })

  it('уже обработан (partially_refunded > 0 в ledger) → refund НЕ вызван повторно (retry после сбоя п.5 тикета)', async () => {
    const { useCase, refund, append } = makeHarness({ alreadyProcessedDiram: REFUND_AMOUNT_DIRAM })

    await useCase.execute(cmd())

    expect(refund).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
  })

  it('split_items_delivery → бросает явно (D-EP09-33: недостижимо в R1, не гадает форму API)', async () => {
    const { useCase } = makeHarness({ order: snapshot({ billingStrategy: 'split_items_delivery' }) })

    await expect(useCase.execute(cmd())).rejects.toThrow(/split_items_delivery/)
  })

  it('провайдер возвращает Err → пробрасывает ошибку, escrow_ledger НЕ дописывается (ни partially_refunded, ни adjustment)', async () => {
    const providerError = new PaymentProviderError('BANK_REQUEST_FAILED', 'HTTP 502')
    const { useCase, append } = makeHarness({ refundResult: err(providerError) })

    await expect(useCase.execute(cmd())).rejects.toBe(providerError)
    expect(append).not.toHaveBeenCalled()
  })

  it('заказ не найден → бросает (invariant violation)', async () => {
    const { useCase } = makeHarness({ order: null })

    await expect(useCase.execute(cmd())).rejects.toThrow(/not found/)
  })

  it('нет hold_created записи с paymentTransactionRef → бросает (invariant violation)', async () => {
    const { useCase } = makeHarness({ holdEntries: [] })

    await expect(useCase.execute(cmd())).rejects.toThrow(/hold_created/)
  })
})
