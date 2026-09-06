/**
 * `ConfirmReturnReceivedUseCase` (EP-11, DTJ-273, SRS-DOM-053/054, SRS-RET-010). Фармацевт
 * подтверждает физическую приёмку — домен ВСЕГДА переходит в `return_confirmed`, `disposition`
 * (`restock`/`destroy`) вычисляется доменом. `ControlledSubstanceMustBeDestroyedError`/
 * `RestockConditionsNotMetError` — НЕ HTTP-ошибки здесь (DTJ-275 п.7): `OrderReturn.confirmReceived`
 * устанавливает `disposition=destroy` НА ОБЪЕКТЕ перед тем, как бросить — это сигнал «restock
 * невозможен», не сбой, use case перехватывает и продолжает с вычисленным disposition.
 *
 * Идемпотентность (AC4) — на уровне статуса: возврат, уже `return_confirmed`, — no-op (не
 * трогает домен/`restock`/`outbox` повторно), а не полагается на идемпотентность самого порта
 * `ReturnsInventoryPort.restock` (один `orderId` не может иметь два активных возврата, SRS-DOM-052,
 * поэтому статус уже уникально идентифицирует «обработан ли этот заказ»).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ErrorCode, NotFoundError, ControlledSubstanceMustBeDestroyedError, RestockConditionsNotMetError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { OrderReturn, ReturnDisposition, ConfirmReceivedChecklist } from '../../domain/index.js'
import { RETURNS_REPOSITORY, type ReturnsRepositoryPort } from '../ports/returns-repository.port.js'
import { RETURNS_ORDERS_PORT, type ReturnsOrdersPort, type OrderReturnContext } from '../ports/orders-facade.port.js'
import { RETURNS_TENANT_SETTINGS_PORT, type ReturnsTenantSettingsPort } from '../ports/returns-tenant-settings.port.js'
import { RETURNS_INVENTORY_PORT, type ReturnsInventoryPort, type ReturnsRestockItem } from '../ports/inventory-facade.port.js'
import { RETURNS_UNIT_OF_WORK, type ReturnsUnitOfWorkPort } from '../ports/returns-unit-of-work.port.js'
import { RETURNS_OUTBOX, type ReturnsOutboxPort } from '../ports/returns-outbox.port.js'

const FAR_FUTURE_DATE = new Date('9999-01-01T00:00:00.000Z')

export interface ConfirmReturnReceivedCommand {
  readonly tenantId: string
  readonly returnId: string
  readonly checklist: ConfirmReceivedChecklist
}

export interface ConfirmReturnReceivedResult {
  readonly disposition: 'restock' | 'destroy' | 'pending_inspection'
}

@Injectable()
export class ConfirmReturnReceivedUseCase {
  // eslint-disable-next-line max-params -- явный @Inject на каждом порте (граф зависимостей виден в providers[]), см. CreateSupportTicketUseCase JSDoc.
  public constructor(
    @Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort,
    @Inject(RETURNS_ORDERS_PORT) private readonly ordersPort: ReturnsOrdersPort,
    @Inject(RETURNS_TENANT_SETTINGS_PORT) private readonly tenantSettings: ReturnsTenantSettingsPort,
    @Inject(RETURNS_INVENTORY_PORT) private readonly inventoryPort: ReturnsInventoryPort,
    @Inject(RETURNS_UNIT_OF_WORK) private readonly unitOfWork: ReturnsUnitOfWorkPort,
    @Inject(RETURNS_OUTBOX) private readonly outbox: ReturnsOutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: ConfirmReturnReceivedCommand): Promise<ConfirmReturnReceivedResult> {
    const orderReturn = await this.repository.findById(command.returnId)
    if (orderReturn === null) {
      throw new NotFoundError({ returnId: command.returnId }, ErrorCode.RETURN_NOT_FOUND, 'Return not found')
    }
    if (orderReturn.status === 'return_confirmed') {
      return { disposition: orderReturn.disposition?.value ?? 'destroy' }
    }
    const order = await this.ordersPort.getOrderForReturn(command.tenantId, orderReturn.orderId)
    if (order === null) {
      throw new NotFoundError({ orderId: orderReturn.orderId }, ErrorCode.NOT_FOUND, 'Order not found')
    }

    const disposition = await this.confirmWithRestockAttempt({
      orderReturn,
      checklist: command.checklist,
      tenantId: command.tenantId,
      order,
    })
    await this.unitOfWork.run(async (tx) => {
      await this.repository.save(orderReturn, tx)
      const items = toRestockItems(order)
      await this.inventoryPort.restock(command.tenantId, orderReturn.orderId, items, disposition.value, tx)
      await this.outbox.append(
        command.tenantId,
        {
          type: 'ReturnConfirmedEvent',
          returnId: orderReturn.id,
          orderId: orderReturn.orderId,
          reason: orderReturn.reason.value,
          disposition: disposition.value,
        },
        tx,
      )
    })
    return { disposition: disposition.value }
  }

  /** Всегда запрашивает restock (`requestRestock: true`) — DTJ-277 не даёт фармацевту отдельного переключателя «пытаться ли»; домен сам форсирует `destroy`, если условия не выполнены (см. JSDoc файла). */
  private async confirmWithRestockAttempt(input: {
    readonly orderReturn: OrderReturn
    readonly checklist: ConfirmReceivedChecklist
    readonly tenantId: string
    readonly order: OrderReturnContext
  }): Promise<ReturnDisposition> {
    const { orderReturn, checklist, tenantId, order } = input
    const minRemainingDays = await this.tenantSettings.getReturnRestockMinRemainingDays(tenantId)
    const restockEligibility = {
      expiryDate: earliestExpiry(order),
      minRemainingDays,
      hasControlledSubstance: order.items.some((item) => item.controlCategory !== 'none'),
    }
    try {
      const result = orderReturn.confirmReceived({ checklist, restockEligibility, requestRestock: true }, this.clock.now())
      return result.disposition
    } catch (error) {
      if (error instanceof ControlledSubstanceMustBeDestroyedError || error instanceof RestockConditionsNotMetError) {
        const forced = orderReturn.disposition
        if (forced !== null) {
          return forced
        }
      }
      throw error
    }
  }
}

function earliestExpiry(order: OrderReturnContext): Date {
  const dates = order.items.map((item) => item.expiresAt).filter((d): d is Date => d !== null)
  return dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : FAR_FUTURE_DATE
}

function toRestockItems(order: OrderReturnContext): readonly ReturnsRestockItem[] {
  return order.items.map((item) => ({
    medicineId: item.medicineId,
    inventoryBatchId: item.inventoryBatchId,
    quantity: item.quantity,
  }))
}
