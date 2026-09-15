/**
 * `RequestReturnUseCase` (EP-11, DTJ-273, SRS-RET-001/002/003/012). Оркестрирует шесть исходов
 * запроса возврата: переадресация `undelivered` в `support`, окно спора, курьерская ветка
 * (заказ ещё `picked_up`) и пост-доставочная ветка (заказ `delivered`).
 *
 * **Отклонение от буквального текста тикета**: `ReturnsDeliveryPort.getAssignedCourier(orderId)`
 * (упомянут в тексте DTJ-273 п.2) не существует на реальном порте (`delivery-facade.port.ts`,
 * DTJ-270 — только `assignReturnCourier`/`calculateReturnFee`). Курьер, УЖЕ везущий заказ
 * (ветка `picked_up`), физически — `orders.courier_id`, не результат НОВОГО назначения; читается
 * из `OrderReturnContext.courierId` (см. `orders-facade.port.ts`), не через `ReturnsDeliveryPort`.
 * Задокументировано также в отчёте сдачи тикета.
 *
 * **Окно спора применяется единообразно** ко всем вызывающим (customer/courier/super_admin) —
 * «исключение» из текста тикета описывает ОТДЕЛЬНЫЙ маршрут `AdminOverrideReturnUseCase`
 * (работает над УЖЕ существующим возвратом, окна не имеет), не роль-специфичный обход ВНУТРИ
 * этого use case.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { isErr } from '@dorutj/domain-kernel'
import { ErrorCode, NotFoundError, ReturnWindowExpiredError, ValidationError, type UserRole } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ID_GENERATOR, type IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'
import { PINO_LOGGER } from '@/common/logging/pino-logger.token.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { OrderReturn, ReturnReason } from '../../domain/index.js'
import { RETURNS_REPOSITORY, type ReturnsRepositoryPort } from '../ports/returns-repository.port.js'
import { RETURNS_ORDERS_PORT, type ReturnsOrdersPort, type OrderReturnContext } from '../ports/orders-facade.port.js'
import { RETURNS_DELIVERY_PORT, type ReturnsDeliveryPort } from '../ports/delivery-facade.port.js'
import { RETURNS_TENANT_SETTINGS_PORT, type ReturnsTenantSettingsPort } from '../ports/returns-tenant-settings.port.js'
import { RETURNS_SUPPORT_FACADE_PORT, type ReturnsSupportFacadePort } from '../ports/returns-support-facade.port.js'
import { RETURNS_UNIT_OF_WORK, type ReturnsUnitOfWorkPort } from '../ports/returns-unit-of-work.port.js'
import { RETURNS_OUTBOX, type ReturnsOutboxPort } from '../ports/returns-outbox.port.js'

const MS_PER_HOUR = 3_600_000
/** SRS-RET-001 — ветка «до вручения», 1:1 с `BEFORE_DELIVERY_REASONS` в `order-return.entity.ts` (домен не экспортирует множество, короткий локальный дубль двух литералов проще, чем расширять domain-экспорт ради него одного). */
const COURIER_BRANCH_REASONS: ReadonlySet<string> = new Set(['refused_at_door', 'undeliverable'])

export interface RequestReturnCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly reason: string
  readonly initiatorId: string
  readonly initiatorRole: UserRole
}

export type RequestReturnResult =
  | { readonly kind: 'return_created'; readonly returnId: string }
  | { readonly kind: 'support_ticket_created'; readonly ticketId: string }

@Injectable()
export class RequestReturnUseCase {
  // eslint-disable-next-line max-params -- явный @Inject на каждом порте, см. CreateSupportTicketUseCase JSDoc (support-модуль, тот же приём).
  public constructor(
    @Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort,
    @Inject(RETURNS_ORDERS_PORT) private readonly ordersPort: ReturnsOrdersPort,
    @Inject(RETURNS_DELIVERY_PORT) private readonly deliveryPort: ReturnsDeliveryPort,
    @Inject(RETURNS_SUPPORT_FACADE_PORT) private readonly supportFacade: ReturnsSupportFacadePort,
    @Inject(RETURNS_TENANT_SETTINGS_PORT) private readonly tenantSettings: ReturnsTenantSettingsPort,
    @Inject(RETURNS_UNIT_OF_WORK) private readonly unitOfWork: ReturnsUnitOfWorkPort,
    @Inject(RETURNS_OUTBOX) private readonly outbox: ReturnsOutboxPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PINO_LOGGER) private readonly logger: Logger,
  ) {}

  public async execute(command: RequestReturnCommand): Promise<RequestReturnResult> {
    const order = await this.ordersPort.getOrderForReturn(command.tenantId, command.orderId)
    if (order === null) {
      throw new NotFoundError({ orderId: command.orderId }, ErrorCode.NOT_FOUND, 'Order not found')
    }
    const reason = parseReason(command.reason)
    if (reason.value === 'undelivered') {
      return this.redirectToSupport(command)
    }
    if (reason.value === 'customer_dispute_post_delivery') {
      await this.assertWithinDisputeWindow(command.tenantId, order)
    }
    if (order.status === 'picked_up' && COURIER_BRANCH_REASONS.has(reason.value)) {
      return this.requestCourierBranch(command, order, reason)
    }
    if (order.status === 'delivered') {
      return this.requestPostDeliveryBranch(command, order, reason)
    }
    throw new ValidationError('Order status does not support a return request for this reason', {
      orderId: command.orderId,
      status: order.status,
      reason: reason.value,
    })
  }

  private async redirectToSupport(command: RequestReturnCommand): Promise<RequestReturnResult> {
    const result = await this.supportFacade.createAutoOrManualTicket({
      tenantId: command.tenantId,
      orderId: command.orderId,
      channel: 'in_app',
      category: 'order_not_received',
      createdBy: command.initiatorId,
      actorRole: command.initiatorRole,
    })
    return { kind: 'support_ticket_created', ticketId: result.ticketId }
  }

  private async assertWithinDisputeWindow(tenantId: string, order: OrderReturnContext): Promise<void> {
    if (order.deliveredAt === null) {
      throw new ValidationError('Order has no deliveredAt yet, cannot evaluate the dispute window', { orderId: order.orderId })
    }
    const windowHours = await this.tenantSettings.getDisputeWindowHours(tenantId)
    const deadline = order.deliveredAt.getTime() + windowHours * MS_PER_HOUR
    if (this.clock.now().getTime() > deadline) {
      throw new ReturnWindowExpiredError({ orderId: order.orderId, deliveredAt: order.deliveredAt.toISOString(), windowHours })
    }
  }

  private async requestCourierBranch(
    command: RequestReturnCommand,
    order: OrderReturnContext,
    reason: ReturnReason,
  ): Promise<RequestReturnResult> {
    if (order.courierId === null) {
      throw new ValidationError('Order has no assigned courier for a before-delivery return', { orderId: order.orderId })
    }
    const feeDiram = await this.deliveryPort.calculateReturnFee(command.tenantId, order.orderId)
    const created = await this.createOrderReturn({
      command,
      order,
      reason,
      courier: { courierId: order.courierId, courierReturnFeeDiram: Money.fromDiram(feeDiram) },
    })
    await this.persistAndPublish(command.tenantId, created)
    return { kind: 'return_created', returnId: created.id }
  }

  private async requestPostDeliveryBranch(
    command: RequestReturnCommand,
    order: OrderReturnContext,
    reason: ReturnReason,
  ): Promise<RequestReturnResult> {
    const created = await this.createOrderReturn({ command, order, reason, courier: {} })
    await this.persistAndPublish(command.tenantId, created)
    this.assignCourierBestEffort(command.tenantId, created.id)
    return { kind: 'return_created', returnId: created.id }
  }

  private async createOrderReturn(input: {
    readonly command: RequestReturnCommand
    readonly order: OrderReturnContext
    readonly reason: ReturnReason
    readonly courier: { readonly courierId?: string; readonly courierReturnFeeDiram?: Money }
  }): Promise<OrderReturn> {
    const { command, order, reason, courier } = input
    const existingNonTerminalReturnIds = await this.repository.findActiveByOrderId(order.orderId)
    return OrderReturn.request(
      {
        id: this.ids.next(),
        orderId: order.orderId,
        reason,
        initiatedBy: command.initiatorId,
        initiatorRole: command.initiatorRole,
        existingNonTerminalReturnIds,
        ...courier,
      },
      this.clock.now(),
    )
  }

  private async persistAndPublish(tenantId: string, created: OrderReturn): Promise<void> {
    await this.unitOfWork.run(async (tx) => {
      await this.repository.save(created, tx)
      await this.outbox.append(
        tenantId,
        {
          type: 'ReturnRequestedEvent',
          returnId: created.id,
          orderId: created.orderId,
          reason: created.reason.value,
          initiatedBy: created.initiatedBy,
          status: created.status,
        },
        tx,
      )
    })
  }

  /** SRS-RET-002 — best-effort, НЕ блокирует ответ API (см. JSDoc `ReturnsDeliveryPort`/риски DTJ-273). */
  private assignCourierBestEffort(tenantId: string, returnId: string): void {
    this.deliveryPort.assignReturnCourier(tenantId, returnId).catch((error: unknown) => {
      this.logger.warn({ err: error, returnId }, 'return_courier_assignment_failed_best_effort')
    })
  }
}

function parseReason(raw: string): ReturnReason {
  const result = ReturnReason.parse(raw)
  if (isErr(result)) {
    throw result.error
  }
  return result.value
}
