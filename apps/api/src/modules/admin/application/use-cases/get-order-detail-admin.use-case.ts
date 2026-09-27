// pharmacy_admin допускается сюда же (не только super_admin) — владение сетью проверяется ПОСЛЕ загрузки заказа, т.к. нужен order.pharmacyId.
import { Inject, Injectable } from '@nestjs/common'
import { CrossTenantAccessDeniedError, NotFoundError, type UserRole } from '@dorutj/contracts'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import { ORDERS_FACADE_PORT, type OrderAdminDetailView, type OrderTimelineView, type OrdersFacadePort } from '../ports/orders-facade.port.js'
import { PAYMENTS_FACADE_PORT, type EscrowLedgerEntryView, type PayoutScheduleEntryView, type PaymentsFacadePort } from '../ports/payments-facade.port.js'
import { PRESCRIPTIONS_FACADE_PORT, type PrescriptionMetaView, type PrescriptionsFacadePort } from '../ports/prescriptions-facade.port.js'

const CASH_COURIER = 'cash_courier' as const

export interface GetOrderDetailAdminActor {
  readonly role: UserRole
  readonly chainId: string | null
}

export interface GetOrderDetailAdminCommand {
  readonly actor: GetOrderDetailAdminActor
  readonly orderId: string
}

export interface OrderDetailAdminResult {
  readonly order: OrderAdminDetailView
  readonly timeline: OrderTimelineView
  // null — эскроу не применяется (cash_courier), не пустая выдача.
  readonly escrowLedger: readonly EscrowLedgerEntryView[] | null
  readonly payoutSchedule: PayoutScheduleEntryView | null
  readonly prescriptionMeta: PrescriptionMetaView | null
}

@Injectable()
export class GetOrderDetailAdminUseCase {
  // eslint-disable-next-line max-params -- NestJS DI: 4 порта-фасада в конструкторе, тот же приём, что record-product-events-batch.use-case.ts
  public constructor(
    @Inject(ORDERS_FACADE_PORT) private readonly ordersFacade: OrdersFacadePort,
    @Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort,
    @Inject(PRESCRIPTIONS_FACADE_PORT) private readonly prescriptionsFacade: PrescriptionsFacadePort,
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
  ) {}

  public async execute(command: GetOrderDetailAdminCommand): Promise<OrderDetailAdminResult> {
    if (command.actor.role !== 'super_admin' && command.actor.role !== 'pharmacy_admin') {
      throw new CrossTenantAccessDeniedError({ role: command.actor.role })
    }
    const order = await this.ordersFacade.getOrderDetail(command.orderId)
    if (order === null) {
      throw new NotFoundError({ orderId: command.orderId })
    }
    if (command.actor.role === 'pharmacy_admin') {
      await this.assertOwnsOrderPharmacy(command.actor, order)
    }
    const timeline = await this.ordersFacade.getOrderTimeline(command.orderId)
    const [escrowLedger, payoutSchedule] = await this.loadPaymentsData(order)
    const prescriptionMeta = order.prescriptionId === null ? null : await this.prescriptionsFacade.getPrescriptionMetaByOrder(command.orderId)
    return {
      order,
      // Недостижимо на практике (та же строка уже найдена order'ом выше) — фолбэк на случай рассинхронизации.
      timeline: timeline ?? { createdAt: order.createdAt, processingStartedAt: null, pickedUpAt: null, deliveredAt: null, slaDeadlineAt: null, cancelReason: null, updatedAt: order.createdAt },
      escrowLedger,
      payoutSchedule,
      prescriptionMeta,
    }
  }

  private async assertOwnsOrderPharmacy(actor: GetOrderDetailAdminActor, order: OrderAdminDetailView): Promise<void> {
    if (actor.chainId === null) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, orderId: order.id })
    }
    const chainId = await this.onboardingFacade.getPharmacyChainId(order.pharmacyId)
    if (chainId !== actor.chainId) {
      throw new CrossTenantAccessDeniedError({ role: actor.role, orderId: order.id })
    }
  }

  private async loadPaymentsData(order: OrderAdminDetailView): Promise<readonly [readonly EscrowLedgerEntryView[] | null, PayoutScheduleEntryView | null]> {
    if (order.paymentMethod === CASH_COURIER) {
      return [null, null]
    }
    return Promise.all([this.paymentsFacade.findEscrowLedgerEntries(order.id), this.paymentsFacade.findPayoutScheduleByOrder(order.id)])
  }
}
