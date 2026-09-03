/**
 * `RefundOrderUseCase` (EP-10, DTJ-245) — 4 критерия приёмки тикета на моках
 * (`PaymentsOrdersPort`/`PaymentProvider`/`EscrowLedgerRepository`/`PayoutScheduleRepository`),
 * без БД/сети. Интеграционное доказательство идемпотентности (в т.ч. реальной конкурентности
 * `Promise.all`) — отдельно, `test/integration/payments/refund-order.integration.spec.ts`.
 *
 * Отдельные переменные для моков методов (не `port.method`) — `@typescript-eslint/unbound-method`,
 * тот же приём, что `cancel-order.use-case.spec.ts`/`create-payment-invoice.use-case.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { ok, err } from '@dorutj/domain-kernel'
import type { PaymentsOrderSnapshot, PaymentsOrdersPort } from '../ports/orders-facade.port.js'
import type { PaymentProvider, RefundRef } from '../ports/payment-provider.port.js'
import type { EscrowLedgerRepository } from '../ports/escrow-ledger-repository.port.js'
import type { PayoutScheduleRepository } from '../ports/payout-schedule-repository.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import { RefundOrderUseCase, type RefundOrderCommand } from './refund-order.use-case.js'

const ORDER_ID = 'order-1'
const TENANT_ID = 'tenant-1'
const HOLD_AMOUNT_DIRAM = 10_000n
const HOLD_PROVIDER_REF = 'mock_inv_original'
const REFUND_PROVIDER_REF = 'mock_refund_x'

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

function snapshot(overrides: Partial<PaymentsOrderSnapshot> = {}): PaymentsOrderSnapshot {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    pharmacyId: 'pharmacy-1',
    status: 'cancelled',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: HOLD_AMOUNT_DIRAM,
    pharmacyChainId: null,
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

type GetOrderByIdMock = ReturnType<typeof vi.fn<PaymentsOrdersPort['getOrderById']>>
type RefundMock = ReturnType<typeof vi.fn<PaymentProvider['refund']>>
type SumByTypeMock = ReturnType<typeof vi.fn<EscrowLedgerRepository['sumByType']>>
type FindByOrderIdMock = ReturnType<typeof vi.fn<EscrowLedgerRepository['findByOrderId']>>
type AppendMock = ReturnType<typeof vi.fn<EscrowLedgerRepository['append']>>
type ReverseIfExistsMock = ReturnType<typeof vi.fn<PayoutScheduleRepository['reverseIfExists']>>

interface Harness {
  readonly useCase: RefundOrderUseCase
  readonly getOrderById: GetOrderByIdMock
  readonly refund: RefundMock
  readonly sumByType: SumByTypeMock
  readonly findByOrderId: FindByOrderIdMock
  readonly append: AppendMock
  readonly reverseIfExists: ReverseIfExistsMock
}

interface HarnessOverrides {
  readonly order?: PaymentsOrderSnapshot | null
  readonly alreadyRefundedDiram?: bigint
  readonly holdDiram?: bigint
  readonly holdEntries?: readonly EscrowLedgerEntry[]
  readonly refundResult?: Awaited<ReturnType<PaymentProvider['refund']>>
  readonly reverseIfExistsResult?: boolean
}

function makeHarness(overrides: HarnessOverrides = {}): Harness {
  const orderResolved = overrides.order === undefined ? snapshot() : overrides.order
  const getOrderById = vi.fn<PaymentsOrdersPort['getOrderById']>().mockResolvedValue(orderResolved)
  const ordersPort: PaymentsOrdersPort = { getOrderById, markPaidEscrow: vi.fn(), cancel: vi.fn() }

  const refund = vi
    .fn<PaymentProvider['refund']>()
    .mockResolvedValue(overrides.refundResult ?? ok<RefundRef>({ providerRefundRef: REFUND_PROVIDER_REF, amountDiram: HOLD_AMOUNT_DIRAM, status: 'succeeded' }))
  const paymentProvider: PaymentProvider = {
    capabilities: vi.fn(),
    createInvoice: vi.fn(),
    getStatus: vi.fn(),
    refund,
    partialRefund: vi.fn(),
  }

  const sumByType = vi.fn<EscrowLedgerRepository['sumByType']>().mockImplementation((_tenantId, _orderId, entryType) => {
    if (entryType === 'refunded_to_customer') return Promise.resolve(overrides.alreadyRefundedDiram ?? 0n)
    if (entryType === 'hold_created') return Promise.resolve(overrides.holdDiram ?? HOLD_AMOUNT_DIRAM)
    return Promise.resolve(0n)
  })
  const findByOrderId = vi.fn<EscrowLedgerRepository['findByOrderId']>().mockResolvedValue([...(overrides.holdEntries ?? [holdEntry()])])
  const append = vi.fn<EscrowLedgerRepository['append']>().mockResolvedValue(undefined)
  const escrowLedger: EscrowLedgerRepository = { append, findByOrderId, sumByType }

  const reverseIfExists = vi.fn<PayoutScheduleRepository['reverseIfExists']>().mockResolvedValue(overrides.reverseIfExistsResult ?? false)
  const payoutScheduleRepo: PayoutScheduleRepository = { reverseIfExists }

  const useCase = new RefundOrderUseCase(ordersPort, paymentProvider, escrowLedger, payoutScheduleRepo, SILENT_LOGGER)
  return { useCase, getOrderById, refund, sumByType, findByOrderId, append, reverseIfExists }
}

function cmd(overrides: Partial<RefundOrderCommand> = {}): RefundOrderCommand {
  return { tenantId: TENANT_ID, orderId: ORDER_ID, reason: 'customer_changed_mind', ...overrides }
}

describe('RefundOrderUseCase (DTJ-245)', () => {
  it('AC1 — non-cash, hold_created=10000: refund вызван один раз, escrow_ledger получает refunded_to_customer=10000 credit', async () => {
    const { useCase, refund, append } = makeHarness()

    await useCase.execute(cmd())

    expect(refund).toHaveBeenCalledTimes(1)
    expect(refund).toHaveBeenCalledWith(HOLD_PROVIDER_REF, `refund:${ORDER_ID}`)
    expect(append).toHaveBeenCalledTimes(1)
    const [entry] = append.mock.calls[0] ?? []
    expect(entry).toMatchObject({
      orderId: ORDER_ID,
      entryType: 'refunded_to_customer',
      direction: 'credit',
      paymentTransactionRef: REFUND_PROVIDER_REF,
      reason: 'customer_changed_mind',
    })
    expect(entry!.amountDiram.diram).toBe(HOLD_AMOUNT_DIRAM)
  })

  it('AC2 — cash_courier: PaymentProvider.refund НЕ вызван (счётчик 0), escrow_ledger не тронут', async () => {
    const { useCase, refund, append, sumByType, findByOrderId } = makeHarness({ order: snapshot({ paymentMethod: 'cash_courier' }) })

    await useCase.execute(cmd())

    expect(refund).not.toHaveBeenCalled()
    expect(append).not.toHaveBeenCalled()
    expect(sumByType).not.toHaveBeenCalled()
    expect(findByOrderId).not.toHaveBeenCalled()
  })

  it('AC3 — повторный вызов (уже отражён в ledger): PaymentProvider.refund вызван РОВНО один раз суммарно', async () => {
    const alreadyRefunded = vi.fn<EscrowLedgerRepository['sumByType']>().mockImplementation((_t, _o, entryType) => {
      if (entryType === 'refunded_to_customer') return Promise.resolve(HOLD_AMOUNT_DIRAM)
      return Promise.resolve(HOLD_AMOUNT_DIRAM)
    })
    const harness = makeHarness()
    // Первый вызов — обычный путь (ещё не рефанднут).
    await harness.useCase.execute(cmd())
    expect(harness.refund).toHaveBeenCalledTimes(1)

    // Второй вызов — "уже возвращён" (симулируем персистентный результат первого вызова:
    // sumByType('refunded_to_customer') теперь возвращает > 0).
    const secondHarness = makeHarness({ alreadyRefundedDiram: HOLD_AMOUNT_DIRAM })
    await secondHarness.useCase.execute(cmd())

    expect(secondHarness.refund).not.toHaveBeenCalled()
    expect(secondHarness.append).not.toHaveBeenCalled()
    void alreadyRefunded
  })

  it('AC4 — payout_schedule уже существует для заказа → payoutScheduleRepo.reverseIfExists вызван', async () => {
    const { useCase, reverseIfExists } = makeHarness({ reverseIfExistsResult: true })

    await useCase.execute(cmd())

    expect(reverseIfExists).toHaveBeenCalledWith(TENANT_ID, ORDER_ID)
    expect(reverseIfExists).toHaveBeenCalledTimes(1)
  })

  it('DoD — paymentMethod проверяется ПЕРВЫМ шагом: cash_courier короткое замыкание раньше EscrowLedgerRepository/PaymentProvider', async () => {
    const { useCase, getOrderById, sumByType, refund } = makeHarness({ order: snapshot({ paymentMethod: 'cash_courier' }) })

    await useCase.execute(cmd())

    expect(getOrderById).toHaveBeenCalledTimes(1)
    expect(sumByType).not.toHaveBeenCalled()
    expect(refund).not.toHaveBeenCalled()
  })

  it('провайдер возвращает Err → пробрасывает ошибку провайдера (не проглатывает), escrow_ledger НЕ дописывается', async () => {
    const providerError = new PaymentProviderError('BANK_REQUEST_FAILED', 'HTTP 502')
    const { useCase, append } = makeHarness({ refundResult: err(providerError) })

    await expect(useCase.execute(cmd())).rejects.toBe(providerError)
    expect(append).not.toHaveBeenCalled()
  })

  it('заказ не найден → бросает (invariant violation — вызывающий код обязан был проверить существование)', async () => {
    const { useCase } = makeHarness({ order: null })

    await expect(useCase.execute(cmd())).rejects.toThrow(/not found/)
  })

  it('нет hold_created записи с paymentTransactionRef → бросает (invariant violation)', async () => {
    const { useCase } = makeHarness({ holdEntries: [] })

    await expect(useCase.execute(cmd())).rejects.toThrow(/hold_created/)
  })

  it('append() конфликтует по ux_escrow_ledger_refunded_once (23505, drizzle wraps в error.cause) → перехватывается как no-op, execute() не бросает', async () => {
    const { useCase, append } = makeHarness()
    const pgCause = { code: '23505', constraint: 'ux_escrow_ledger_refunded_once' }
    const conflict = new Error('duplicate key value violates unique constraint "ux_escrow_ledger_refunded_once"', { cause: pgCause })
    append.mockRejectedValueOnce(conflict)

    await expect(useCase.execute(cmd())).resolves.toBeUndefined()
  })

  it('append() бросает НЕсвязанную ошибку (другой constraint/code) → пробрасывается, НЕ проглатывается', async () => {
    const { useCase, append } = makeHarness()
    const unrelated = new Error('connection reset', { cause: { code: '08006' } })
    append.mockRejectedValueOnce(unrelated)

    await expect(useCase.execute(cmd())).rejects.toBe(unrelated)
  })
})
