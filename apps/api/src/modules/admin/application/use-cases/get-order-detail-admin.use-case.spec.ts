import { describe, expect, it, vi } from 'vitest'
import { CrossTenantAccessDeniedError, NotFoundError } from '@dorutj/contracts'
import { GetOrderDetailAdminUseCase } from './get-order-detail-admin.use-case.js'
import type { OrderAdminDetailView, OrderTimelineView, OrdersFacadePort } from '../ports/orders-facade.port.js'
import type { PaymentsFacadePort } from '../ports/payments-facade.port.js'
import type { PrescriptionsFacadePort } from '../ports/prescriptions-facade.port.js'
import type { OnboardingFacadePort } from '../ports/onboarding-facade.port.js'

const BASE_ORDER: OrderAdminDetailView = {
  id: 'order-1',
  orderNumber: 'DTJ-260927-00001',
  status: 'processing',
  tenantId: 'tenant-1',
  pharmacyId: 'pharmacy-1',
  customerId: 'customer-1',
  paymentMethod: 'alif_mobi',
  totalAmountDiram: 10_000,
  prescriptionId: null,
  createdAt: new Date('2026-09-27T00:00:00.000Z'),
}

const BASE_TIMELINE: OrderTimelineView = {
  createdAt: BASE_ORDER.createdAt,
  processingStartedAt: new Date('2026-09-27T01:00:00.000Z'),
  pickedUpAt: null,
  deliveredAt: null,
  slaDeadlineAt: null,
  cancelReason: null,
  updatedAt: new Date('2026-09-27T01:00:00.000Z'),
}

interface Fakes {
  readonly ordersFacade: OrdersFacadePort
  readonly paymentsFacade: PaymentsFacadePort
  readonly prescriptionsFacade: PrescriptionsFacadePort
  readonly onboardingFacade: OnboardingFacadePort
  readonly getOrderDetail: ReturnType<typeof vi.fn>
  readonly getOrderTimeline: ReturnType<typeof vi.fn>
  readonly findEscrowLedgerEntries: ReturnType<typeof vi.fn>
  readonly findPayoutScheduleByOrder: ReturnType<typeof vi.fn>
  readonly getPrescriptionMetaByOrder: ReturnType<typeof vi.fn>
  readonly getPharmacyChainId: ReturnType<typeof vi.fn>
}

function fakes(order: OrderAdminDetailView | null, timeline: OrderTimelineView | null): Fakes {
  const getOrderDetail = vi.fn().mockResolvedValue(order)
  const getOrderTimeline = vi.fn().mockResolvedValue(timeline)
  const findEscrowLedgerEntries = vi.fn().mockResolvedValue([])
  const findPayoutScheduleByOrder = vi.fn().mockResolvedValue(null)
  const getPrescriptionMetaByOrder = vi.fn().mockResolvedValue(null)
  const getPharmacyChainId = vi.fn().mockResolvedValue(null)
  return {
    ordersFacade: { findOrdersAny: vi.fn(), getOrderDetail, getOrderTimeline },
    paymentsFacade: {
      findEscrowLedgerEntries,
      findPayoutSchedule: vi.fn(),
      findPayoutScheduleByOrder,
    },
    prescriptionsFacade: { getPrescriptionMetaByOrder },
    onboardingFacade: {
      findPharmacyAccountsAny: vi.fn(),
      getPharmacyChainId,
      getScheduleAndZone: vi.fn(),
      updateSchedule: vi.fn(),
      updateDeliveryZone: vi.fn(),
    },
    getOrderDetail,
    getOrderTimeline,
    findEscrowLedgerEntries,
    findPayoutScheduleByOrder,
    getPrescriptionMetaByOrder,
    getPharmacyChainId,
  }
}

function buildUseCase(f: Fakes): GetOrderDetailAdminUseCase {
  return new GetOrderDetailAdminUseCase(f.ordersFacade, f.paymentsFacade, f.prescriptionsFacade, f.onboardingFacade)
}

describe('GetOrderDetailAdminUseCase (DTJ-355/363)', () => {
  it('super_admin — агрегирует 4 источника для non-cash_courier заказа с рецептом, БЕЗ проверки владения', async () => {
    const order: OrderAdminDetailView = { ...BASE_ORDER, prescriptionId: 'rx-1' }
    const f = fakes(order, BASE_TIMELINE)
    f.findEscrowLedgerEntries.mockResolvedValue([{ orderId: 'order-1', entryType: 'hold', direction: 'debit', amountDiram: 10_000, reason: null, actorUserId: null, paymentTransactionRef: null, createdAt: new Date() }])
    f.findPayoutScheduleByOrder.mockResolvedValue({ orderId: 'order-1', orderNumber: order.orderNumber, pharmacyId: order.pharmacyId, grossAmountDiram: 10_000, commissionDiram: 500, netAmountDiram: 9_500, status: 'pending', dueAt: null, paidAt: null })
    f.getPrescriptionMetaByOrder.mockResolvedValue({ prescriptionId: 'rx-1', status: 'verified' })
    const useCase = buildUseCase(f)

    const result = await useCase.execute({ actor: { role: 'super_admin', chainId: null }, orderId: 'order-1' })

    expect(result.order).toEqual(order)
    expect(result.timeline).toEqual(BASE_TIMELINE)
    expect(result.escrowLedger).toHaveLength(1)
    expect(result.payoutSchedule?.status).toBe('pending')
    expect(result.prescriptionMeta).toEqual({ prescriptionId: 'rx-1', status: 'verified' })
    expect(f.findEscrowLedgerEntries).toHaveBeenCalledWith('order-1')
    expect(f.findPayoutScheduleByOrder).toHaveBeenCalledWith('order-1')
    expect(f.getPrescriptionMetaByOrder).toHaveBeenCalledWith('order-1')
    expect(f.getPharmacyChainId).not.toHaveBeenCalled()
  })

  it('DoD — cash_courier: escrowLedger/payoutSchedule = null, PaymentsFacadePort НЕ вызывается вовсе (экономия I/O)', async () => {
    const order: OrderAdminDetailView = { ...BASE_ORDER, paymentMethod: 'cash_courier' }
    const f = fakes(order, BASE_TIMELINE)
    const useCase = buildUseCase(f)

    const result = await useCase.execute({ actor: { role: 'super_admin', chainId: null }, orderId: 'order-1' })

    expect(result.escrowLedger).toBeNull()
    expect(result.payoutSchedule).toBeNull()
    expect(f.findEscrowLedgerEntries).not.toHaveBeenCalled()
    expect(f.findPayoutScheduleByOrder).not.toHaveBeenCalled()
  })

  it('prescriptionId === null — prescriptionMeta = null, PrescriptionsFacadePort НЕ вызывается', async () => {
    const f = fakes(BASE_ORDER, BASE_TIMELINE)
    const useCase = buildUseCase(f)

    const result = await useCase.execute({ actor: { role: 'super_admin', chainId: null }, orderId: 'order-1' })

    expect(result.prescriptionMeta).toBeNull()
    expect(f.getPrescriptionMetaByOrder).not.toHaveBeenCalled()
  })

  it('несуществующий orderId — NotFoundError', async () => {
    const f = fakes(null, null)
    const useCase = buildUseCase(f)

    await expect(useCase.execute({ actor: { role: 'super_admin', chainId: null }, orderId: 'missing' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('роль вне {super_admin, pharmacy_admin} — CrossTenantAccessDeniedError, ни один порт не вызывается', async () => {
    const f = fakes(BASE_ORDER, BASE_TIMELINE)
    const useCase = buildUseCase(f)

    await expect(useCase.execute({ actor: { role: 'pharmacist', chainId: null }, orderId: 'order-1' })).rejects.toBeInstanceOf(CrossTenantAccessDeniedError)
    expect(f.getOrderDetail).not.toHaveBeenCalled()
  })

  it('DTJ-363 — pharmacy_admin своей сети (chainId совпадает с сетью аптеки заказа) — 200, полная агрегация', async () => {
    const f = fakes(BASE_ORDER, BASE_TIMELINE)
    f.getPharmacyChainId.mockResolvedValue('chain-a')
    const useCase = buildUseCase(f)

    const result = await useCase.execute({ actor: { role: 'pharmacy_admin', chainId: 'chain-a' }, orderId: 'order-1' })

    expect(result.order).toEqual(BASE_ORDER)
    expect(f.getPharmacyChainId).toHaveBeenCalledWith(BASE_ORDER.pharmacyId)
  })

  it('DTJ-363 — pharmacy_admin ЧУЖОЙ сети — CrossTenantAccessDeniedError, timeline/payments/prescription НЕ запрашиваются', async () => {
    const f = fakes(BASE_ORDER, BASE_TIMELINE)
    f.getPharmacyChainId.mockResolvedValue('chain-b')
    const useCase = buildUseCase(f)

    await expect(useCase.execute({ actor: { role: 'pharmacy_admin', chainId: 'chain-a' }, orderId: 'order-1' })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(f.getOrderTimeline).not.toHaveBeenCalled()
    expect(f.findEscrowLedgerEntries).not.toHaveBeenCalled()
  })

  it('DTJ-363 — pharmacy_admin без chainId в актора (некорректный токен) — CrossTenantAccessDeniedError, порт владения не вызывается', async () => {
    const f = fakes(BASE_ORDER, BASE_TIMELINE)
    const useCase = buildUseCase(f)

    await expect(useCase.execute({ actor: { role: 'pharmacy_admin', chainId: null }, orderId: 'order-1' })).rejects.toBeInstanceOf(
      CrossTenantAccessDeniedError,
    )
    expect(f.getPharmacyChainId).not.toHaveBeenCalled()
  })
})
