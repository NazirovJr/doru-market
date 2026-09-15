/**
 * `AdminOverrideReturnUseCase` (EP-11, DTJ-273, REQ-RET-9). `pharmacy_admin` своей сети/
 * `super_admin` форсирует `return_confirmed` из `return_rejected` — восстанавливает ТОТ ЖЕ
 * событийный путь, что обычное подтверждение (публикует `ReturnConfirmedEvent`, DTJ-274
 * реагирует одинаково независимо от источника, см. JSDoc `order-return.entity.ts`).
 *
 * Грубая проверка роли — `@Roles()` на контроллере (DTJ-275). Точная проверка владения («своя
 * сеть») — `ReturnsPolicy.canOverride` здесь, `02` §3.4.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ErrorCode, ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { RETURNS_REPOSITORY, type ReturnsRepositoryPort } from '../ports/returns-repository.port.js'
import { RETURNS_ORDERS_PORT, type ReturnsOrdersPort } from '../ports/orders-facade.port.js'
import { RETURNS_UNIT_OF_WORK, type ReturnsUnitOfWorkPort } from '../ports/returns-unit-of-work.port.js'
import { RETURNS_OUTBOX, type ReturnsOutboxPort } from '../ports/returns-outbox.port.js'
import { ReturnsPolicy, type ReturnsPolicyActor } from '../../returns-policy.guard.js'

export interface AdminOverrideReturnCommand {
  readonly tenantId: string
  readonly returnId: string
  readonly actorId: string
  readonly actor: ReturnsPolicyActor
  readonly reason: string
}

@Injectable()
export class AdminOverrideReturnUseCase {
  private readonly policy = new ReturnsPolicy()

  // eslint-disable-next-line max-params -- явный @Inject на каждом порте (граф зависимостей виден в providers[]), см. CreateSupportTicketUseCase JSDoc.
  public constructor(
    @Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort,
    @Inject(RETURNS_ORDERS_PORT) private readonly ordersPort: ReturnsOrdersPort,
    @Inject(RETURNS_UNIT_OF_WORK) private readonly unitOfWork: ReturnsUnitOfWorkPort,
    @Inject(RETURNS_OUTBOX) private readonly outbox: ReturnsOutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: AdminOverrideReturnCommand): Promise<void> {
    const orderReturn = await this.repository.findById(command.returnId)
    if (orderReturn === null) {
      throw new NotFoundError({ returnId: command.returnId }, ErrorCode.RETURN_NOT_FOUND, 'Return not found')
    }
    const order = await this.ordersPort.getOrderForReturn(command.tenantId, orderReturn.orderId)
    if (order === null || !this.policy.canOverride(command.actor, order)) {
      throw new ForbiddenError('Actor is not allowed to override this return', { returnId: command.returnId })
    }
    orderReturn.adminOverride(command.actorId, command.reason, this.clock.now())
    const disposition = orderReturn.disposition
    if (disposition === null) {
      // Недостижимо: `adminOverride()` всегда устанавливает `disposition = restock` (см. её тело).
      throw new Error('adminOverride() did not set a disposition — invariant violation')
    }

    await this.unitOfWork.run(async (tx) => {
      await this.repository.save(orderReturn, tx)
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
  }
}
