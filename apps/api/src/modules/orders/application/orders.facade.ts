/**
 * `OrdersFacade` (EP-09, DTJ-222) — единственная точка, через которую ДРУГИЕ модули
 * (`payments` DTJ-242/244/245/253/254, позже EP-11/12/13/14) читают/меняют заказы, не
 * импортируя `orders/domain` напрямую (`02` §1.2). Публичный API межэпикового контракта —
 * менять сигнатуры дорого, поэтому здесь ровно то, что требует DTJ-222, не больше.
 *
 * Методы — тонкая обёртка: `OrderRepositoryPort.findById` → метод домена (бросает
 * `DomainError`-потомков при недопустимом переходе, не оборачивается в `Result` — тот же стиль,
 * что и сами методы-намерения `Order`) → `save` в той же (опциональной) транзакции. Никакой
 * бизнес-логики сверх этого — авторизация (`OrderPolicy`), резолвинг SLA/просрочки остатка —
 * забота вызывающего use case (ещё не ticketed), не фасада.
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043/046, доработка DTJ-227 по замечанию CTO): `OrderRepositoryPort.
 * findById`/`findByCheckoutAttemptId` теперь несут `tenantId` первым параметром — эта правка
 * прокидывает его через ВСЕ публичные методы фасада. Там, где добавление `tenantId` как
 * отдельного параметра превысило бы `max-params` ≤3 (C5) — `tenantId` вошёл ПОЛЕМ
 * соответствующего command-объекта (`MarkPaidEscrowCommand`/`StartProcessingFacadeCommand`/
 * `MarkPickedUpCommand`/`CancelOrderCommand`/`MarkDeliveredCommand`), а не добавлен позиционным
 * 4-м аргументом. Чужой тенант ⇒ `findOrThrow` не находит заказ ⇒ `NotFoundError` (404, не 403
 * — SRS-API-046: существование чужой строки не подтверждается).
 *
 * `mergeGuestCart` (EP-09, DTJ-226) — тонкая делегация к `MergeGuestCartUseCase`
 * (`application/cart/merge-guest-cart.use-case.ts`). Ticket «Риски»: точка ВЫЗОВА — hook в
 * `auth`-flow (EP-01) ПОСЛЕ успешного OTP-логина, вне периметра DTJ-226; здесь только
 * экспорт, чтобы `auth` мог дёрнуть его через `OrdersFacade` (единственный легальный
 * межмодульный путь, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2), не импортируя
 * `orders/application/cart/**` напрямую (`no-cross-module-deep-import`, depcruise).
 * `@Optional()` — НЕ ломает существующие однопараметровые `new OrdersFacade(repo)` в
 * `orders.facade.spec.ts` (DTJ-222); в боевой проводке (`orders.module.ts`)
 * провайдер всегда есть, `undefined` там недостижимо.
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import { NotFoundError, type OrderPaymentMethod } from '@dorutj/contracts'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
  type OrderUnitOfWorkTx,
} from './ports/order-repository.port.js'
import { MergeGuestCartUseCase, type MergeGuestCartResult } from './cart/merge-guest-cart.use-case.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderCancelActor, OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'

export interface MarkPaidEscrowCommand {
  readonly tenantId: string
  readonly txId: string
  readonly paidAt: Date
  readonly ledgerHoldWillBeRecorded: true
}

export interface StartProcessingFacadeCommand {
  readonly tenantId: string
  readonly pharmacistId: string
  readonly slaDeadlineAt: Date
  readonly hasExpiredReservedBatch: boolean
  readonly now: Date
}

export interface MarkPickedUpCommand {
  readonly tenantId: string
  readonly handoverOtpId: string
  readonly now: Date
}

export interface MarkDeliveredCommand {
  readonly tenantId: string
  readonly now: Date
}

export interface CancelOrderCommand {
  readonly tenantId: string
  readonly reason: OrderCancelReason
  readonly actor: OrderCancelActor
  readonly now: Date
}

// Единственный легальный путь, каким delivery читает данные заказа (см. db/schema/orders.ts).
export interface DeliverySnapshot {
  readonly orderId: string
  readonly tenantId: string
  readonly pharmacyId: string
  readonly medicineIds: readonly string[]
  readonly itemsCount: number
  readonly paymentMethod: OrderPaymentMethod
  readonly deliveryGeoPoint: GeoPoint | null
  // Стоимость доставки, зафиксированная на checkout (Order.deliveryFee — readonly, тариф после не пересчитывается).
  readonly deliveryFeeDiram: bigint
}

@Injectable()
export class OrdersFacade {
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly repository: OrderRepositoryPort,
    @Optional() @Inject(MergeGuestCartUseCase) private readonly mergeGuestCartUseCase?: MergeGuestCartUseCase,
  ) {}

  /** См. JSDoc файла — делегация к `MergeGuestCartUseCase` (DTJ-226) для вызова из `auth`. */
  async mergeGuestCart(tenantId: string, sessionToken: string, customerId: string): Promise<MergeGuestCartResult> {
    if (this.mergeGuestCartUseCase === undefined) {
      throw new Error('OrdersFacade.mergeGuestCart: MergeGuestCartUseCase provider is not wired (DI misconfiguration)')
    }
    return this.mergeGuestCartUseCase.execute(tenantId, sessionToken, customerId)
  }

  async getOrderForCheckoutAttempt(tenantId: string, checkoutAttemptId: string): Promise<Order | null> {
    return this.repository.findByCheckoutAttemptId(tenantId, checkoutAttemptId)
  }

  async getOrderById(tenantId: string, orderId: string, tx?: OrderUnitOfWorkTx): Promise<Order | null> {
    return this.repository.findById(tenantId, orderId, tx)
  }

  async getDeliverySnapshot(orderId: string, tx?: OrderUnitOfWorkTx): Promise<DeliverySnapshot | null> {
    const order = await this.repository.findByIdAcrossTenants(orderId, tx)
    if (order === null) return null
    return {
      orderId: order.id,
      tenantId: order.tenantId,
      pharmacyId: order.pharmacyId,
      medicineIds: order.items.map((item) => item.medicineId),
      itemsCount: order.items.length,
      paymentMethod: order.paymentMethod,
      deliveryGeoPoint: order.deliveryGeoPoint,
      deliveryFeeDiram: order.deliveryFee.diram,
    }
  }

  async markPaidEscrow(orderId: string, cmd: MarkPaidEscrowCommand, tx?: OrderUnitOfWorkTx): Promise<void> {
    const order = await this.findOrThrow(cmd.tenantId, orderId, tx)
    order.markPaidEscrow(cmd.txId, cmd.paidAt, cmd.ledgerHoldWillBeRecorded)
    await this.repository.save(order, tx)
  }

  async startProcessing(orderId: string, cmd: StartProcessingFacadeCommand, tx?: OrderUnitOfWorkTx): Promise<void> {
    const order = await this.findOrThrow(cmd.tenantId, orderId, tx)
    order.startProcessing(
      { pharmacistId: cmd.pharmacistId, slaDeadlineAt: cmd.slaDeadlineAt, hasExpiredReservedBatch: cmd.hasExpiredReservedBatch },
      cmd.now,
    )
    await this.repository.save(order, tx)
  }

  async markPickedUp(orderId: string, cmd: MarkPickedUpCommand, tx?: OrderUnitOfWorkTx): Promise<void> {
    const order = await this.findOrThrow(cmd.tenantId, orderId, tx)
    order.markPickedUp(cmd.handoverOtpId, cmd.now)
    await this.repository.save(order, tx)
  }

  async markDelivered(orderId: string, cmd: MarkDeliveredCommand, tx?: OrderUnitOfWorkTx): Promise<void> {
    const order = await this.findOrThrow(cmd.tenantId, orderId, tx)
    order.markDelivered(cmd.now)
    await this.repository.save(order, tx)
  }

  async cancel(orderId: string, cmd: CancelOrderCommand, tx?: OrderUnitOfWorkTx): Promise<void> {
    const order = await this.findOrThrow(cmd.tenantId, orderId, tx)
    order.cancel(cmd.reason, cmd.actor, cmd.now)
    await this.repository.save(order, tx)
  }

  private async findOrThrow(tenantId: string, orderId: string, tx?: OrderUnitOfWorkTx): Promise<Order> {
    const order = await this.repository.findById(tenantId, orderId, tx)
    if (order === null) {
      throw new NotFoundError({ orderId })
    }
    return order
  }
}
