/**
 * `GET /api/v1/orders/:id` (терминал фармацевта) — деталь заказа для экрана сборки.
 *
 * ДОБАВЛЕНО (DTJ-312 доработка, foundIssue приёмки) — `partialFulfillment` из `findLatestByOrderId`:
 * клиент раньше определял «ждём подтверждения» эвристикой (сравнение `totalAmountDiram`) — сумма
 * может измениться и по другим причинам, статус запроса точнее. `findLatestByOrderId` не
 * фильтрует по статусу (см. JSDoc порта) — любой исход валиден для отображения.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError, type PharmacyTerminalOrderDetailDto, type UserRole } from '@dorutj/contracts'
import { ORDER_REPOSITORY_PORT, type OrderRepositoryPort } from '@/modules/orders/application/ports/order-repository.port.js'
import { CATALOG_FACADE_PORT, type CatalogFacadePort } from '@/modules/orders/application/ports/catalog-facade.port.js'
import {
  PARTIAL_FULFILLMENT_REQUEST_REPOSITORY,
  type PartialFulfillmentRequestRepositoryPort,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'
import { toOrderDto, toOrderItemDto } from '@/modules/orders/domain/order.mapper.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'

export interface GetOrderDetailActor {
  readonly role: UserRole
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly chainId: string | null
}

export interface GetOrderDetailCommand {
  readonly orderId: string
  readonly actor: GetOrderDetailActor
}

@Injectable()
export class GetOrderDetailUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(CATALOG_FACADE_PORT) private readonly catalogFacade: CatalogFacadePort,
    @Inject(PARTIAL_FULFILLMENT_REQUEST_REPOSITORY) private readonly requestRepository: PartialFulfillmentRequestRepositoryPort,
  ) {}

  async execute(cmd: GetOrderDetailCommand): Promise<PharmacyTerminalOrderDetailDto> {
    const order = await this.orderRepository.findById(cmd.actor.tenantId, cmd.orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    await this.assertCanView(order, cmd.actor)

    const medicineIds = order.items.map((item) => item.medicineId)
    const snapshots = await this.catalogFacade.getMedicineSnapshot(medicineIds)
    const latestRequest = await this.requestRepository.findLatestByOrderId(cmd.actor.tenantId, order.id)

    return {
      ...toOrderDto(order),
      items: order.items.map((item) => ({
        ...toOrderItemDto(item, order.id),
        // Снимок каталога может не найти медикамент (редкая рассинхронизация) — id как крайний фолбэк.
        medicineName: snapshots.get(item.medicineId)?.tradeName ?? item.medicineId,
      })),
      partialFulfillment:
        latestRequest === null
          ? null
          : { status: latestRequest.status, requestedAt: latestRequest.requestedAt.toISOString(), expiresAt: latestRequest.expiresAt.toISOString() },
    }
  }

  // Своя аптека — доступ есть всегда; pharmacy_admin дополнительно видит всю сеть (чужая сеть — 403).
  // Роль вне этих двух (напр. будущий customer) — явная ветка ниже, легко добавить не ломая структуру.
  private async assertCanView(order: Order, actor: GetOrderDetailActor): Promise<void> {
    if (actor.role === 'pharmacist' || actor.role === 'pharmacy_admin') {
      if (actor.pharmacyId === order.pharmacyId) return
      if (actor.role === 'pharmacy_admin' && actor.chainId !== null) {
        const networkPharmacyIds = await this.orderRepository.findPharmacyIdsByChain(actor.tenantId, actor.chainId)
        if (networkPharmacyIds.includes(order.pharmacyId)) return
      }
    }
    throw new ForbiddenError('This order cannot be viewed by this actor', { orderId: order.id })
  }
}
