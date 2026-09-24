/**
 * Unit-тесты `CaptureEscrowUseCase` (EP-10, DTJ-244) — все порты замоканы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { EscrowLedgerRepository } from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import type { PaymentsOrderSnapshot, PaymentsOrdersPort, PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'
import type { PaymentsUnitOfWorkPort } from '@/modules/payments/application/ports/payments-unit-of-work.port.js'
import type { PaymentsTenancyPort, PaymentsTenantSettings } from '@/modules/payments/application/ports/tenancy-facade.port.js'
import type { ProcessedEventsPort } from '@/common/events/processed-events.port.js'
import type { PayoutScheduleRepository } from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import { CaptureEscrowUseCase, type CaptureEscrowCommand } from './capture-escrow.use-case.js'

const TX_MARKER: PaymentsUnitOfWorkTx = { marker: 'tx' }
const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
const CMD: CaptureEscrowCommand = { tenantId: 'tenant-1', orderId: 'order-1', eventId: 'evt-1' }

function makeOrder(overrides: Partial<PaymentsOrderSnapshot> = {}): PaymentsOrderSnapshot {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    pharmacyId: 'pharmacy-1',
    status: 'processing',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: 20_000n,
    pharmacyChainId: null,
    items: [{ platformFeeDiram: 1_600n }],
    billingStrategy: 'single_invoice',
    ...overrides,
  }
}

function makeSettings(overrides: Partial<PaymentsTenantSettings> = {}): PaymentsTenantSettings {
  return {
    tenantId: 'tenant-1',
    holdPeriodDays: 7,
    enabledPaymentMethods: ['cash_courier'],
    useSplitBilling: false,
    disputeAutoRefundThresholdDiram: 0n,
    disputeResolutionSlaHours: 72,
    ...overrides,
  }
}

function buildHarness() {
  const markProcessed = vi.fn<ProcessedEventsPort['markProcessed']>().mockResolvedValue(true)
  const processedEvents = { markProcessed }
  const getOrderById = vi.fn<PaymentsOrdersPort['getOrderById']>().mockResolvedValue(makeOrder())
  const ordersPort = { getOrderById, markPaidEscrow: vi.fn(), cancel: vi.fn() }
  const append = vi.fn<EscrowLedgerRepository['append']>().mockResolvedValue(undefined)
  const ledgerRepository = { append } as unknown as EscrowLedgerRepository
  const insertPending = vi.fn<PayoutScheduleRepository['insertPending']>().mockResolvedValue(undefined)
  const payoutScheduleRepo = { reverseIfExists: vi.fn(), insertPending } as unknown as PayoutScheduleRepository
  const getTenantSettings = vi.fn<PaymentsTenancyPort['getTenantSettings']>().mockResolvedValue(makeSettings())
  const tenancyPort = { getTenantSettings }
  const unitOfWork: PaymentsUnitOfWorkPort = { run: (cb) => cb(TX_MARKER) }

  const useCase = new CaptureEscrowUseCase(
    processedEvents,
    ordersPort,
    ledgerRepository,
    payoutScheduleRepo,
    tenancyPort,
    unitOfWork,
    SILENT_LOGGER,
  )
  return { useCase, markProcessed, getOrderById, append, insertPending, getTenantSettings }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CaptureEscrowUseCase (DTJ-244)', () => {
  it('AC1: non-cash заказ — platform_fee_captured + captured_to_pharmacy + payout_schedule(pending), суммы корректны', async () => {
    const h = buildHarness()

    await h.useCase.execute(CMD)

    expect(h.append).toHaveBeenCalledTimes(2)
    expect(h.append.mock.calls[0]![0]).toMatchObject({ entryType: 'platform_fee_captured', direction: 'credit', orderId: 'order-1' })
    expect((h.append.mock.calls[0]![0] as { amountDiram: { diram: bigint } }).amountDiram.diram).toBe(1_600n)
    expect(h.append.mock.calls[1]![0]).toMatchObject({ entryType: 'captured_to_pharmacy', direction: 'credit', orderId: 'order-1' })
    expect((h.append.mock.calls[1]![0] as { amountDiram: { diram: bigint } }).amountDiram.diram).toBe(18_400n) // 20000 - 1600

    expect(h.insertPending).toHaveBeenCalledExactlyOnceWith(
      {
        orderId: 'order-1',
        pharmacyId: 'pharmacy-1',
        grossAmountDiram: 20_000n,
        commissionDiram: 1_600n,
        netAmountDiram: 18_400n,
        holdPeriodDays: 7,
      },
      TX_MARKER,
    )
  })

  it('AC2: то же событие доставлено ПОВТОРНО (тот же eventId) — markProcessed возвращает false — ledger/payout НЕ вызываются вовсе', async () => {
    const h = buildHarness()
    h.markProcessed.mockResolvedValue(false)

    await h.useCase.execute(CMD)

    expect(h.getOrderById).not.toHaveBeenCalled()
    expect(h.append).not.toHaveBeenCalled()
    expect(h.insertPending).not.toHaveBeenCalled()
  })

  it('AC3: cash_courier заказ — NOOP, escrow_ledger/payout_schedule НЕ содержат ни одной строки для заказа', async () => {
    const h = buildHarness()
    h.getOrderById.mockResolvedValue(makeOrder({ paymentMethod: 'cash_courier', status: 'confirmed' }))

    await h.useCase.execute(CMD)

    expect(h.append).not.toHaveBeenCalled()
    expect(h.insertPending).not.toHaveBeenCalled()
    expect(h.getTenantSettings).not.toHaveBeenCalled()
  })

  it('AC4: hold_period_days снэпшотится НА МОМЕНТ этого вызова (значение из getTenantSettings), не пересчитывается позже', async () => {
    const h = buildHarness()
    h.getTenantSettings.mockResolvedValue(makeSettings({ holdPeriodDays: 3 }))

    await h.useCase.execute(CMD)

    expect(h.insertPending.mock.calls[0]![0].holdPeriodDays).toBe(3)
  })

  it('заказ без комиссии (Σ platformFeeDiram = 0) — platform_fee_captured пропущен (0 — не валидная сумма для EscrowLedgerEntry), captured_to_pharmacy получает ПОЛНУЮ сумму', async () => {
    const h = buildHarness()
    h.getOrderById.mockResolvedValue(makeOrder({ items: [{ platformFeeDiram: 0n }] }))

    await h.useCase.execute(CMD)

    expect(h.append).toHaveBeenCalledTimes(1)
    expect(h.append.mock.calls[0]![0]).toMatchObject({ entryType: 'captured_to_pharmacy' })
    expect((h.append.mock.calls[0]![0] as { amountDiram: { diram: bigint } }).amountDiram.diram).toBe(20_000n)
    expect(h.insertPending.mock.calls[0]![0]).toMatchObject({ commissionDiram: 0n, netAmountDiram: 20_000n })
  })

  it('заказ не найден (defensive) — бросает, не создаёт частичное состояние', async () => {
    const h = buildHarness()
    h.getOrderById.mockResolvedValue(null)

    await expect(h.useCase.execute(CMD)).rejects.toThrow('not found')
    expect(h.append).not.toHaveBeenCalled()
  })

  it('Σ(platform_fee_diram) агрегируется по НЕСКОЛЬКИМ позициям заказа', async () => {
    const h = buildHarness()
    h.getOrderById.mockResolvedValue(makeOrder({ items: [{ platformFeeDiram: 500n }, { platformFeeDiram: 300n }, { platformFeeDiram: 800n }] }))

    await h.useCase.execute(CMD)

    expect(h.insertPending.mock.calls[0]![0].commissionDiram).toBe(1_600n)
  })
})
