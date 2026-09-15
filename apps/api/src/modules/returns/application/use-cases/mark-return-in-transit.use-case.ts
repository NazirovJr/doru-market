/**
 * `MarkReturnInTransitUseCase` (EP-11, DTJ-273, SRS-RET-002/005). `return_requested →
 * return_in_transit` — курьер назначен ПОСЛЕ запроса (пост-доставочная ветка). Курьерская
 * компенсация (`courierReturnFeeDiram`) начисляется ВСЕГДА (SRS-RET-005) — `calculateReturnFee`
 * не возвращает `null`, домен требует значение обязательным параметром.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ErrorCode, NotFoundError } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { RETURNS_REPOSITORY, type ReturnsRepositoryPort } from '../ports/returns-repository.port.js'
import { RETURNS_UNIT_OF_WORK, type ReturnsUnitOfWorkPort } from '../ports/returns-unit-of-work.port.js'
import { RETURNS_OUTBOX, type ReturnsOutboxPort } from '../ports/returns-outbox.port.js'
import { RETURNS_DELIVERY_PORT, type ReturnsDeliveryPort } from '../ports/delivery-facade.port.js'

export interface MarkReturnInTransitCommand {
  readonly tenantId: string
  readonly returnId: string
  readonly orderId: string
  readonly courierId: string
}

@Injectable()
export class MarkReturnInTransitUseCase {
  // eslint-disable-next-line max-params -- явный @Inject на каждом порте (граф зависимостей виден в providers[]), см. CreateSupportTicketUseCase JSDoc.
  public constructor(
    @Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort,
    @Inject(RETURNS_DELIVERY_PORT) private readonly deliveryPort: ReturnsDeliveryPort,
    @Inject(RETURNS_UNIT_OF_WORK) private readonly unitOfWork: ReturnsUnitOfWorkPort,
    @Inject(RETURNS_OUTBOX) private readonly outbox: ReturnsOutboxPort,
  ) {}

  public async execute(command: MarkReturnInTransitCommand): Promise<void> {
    const orderReturn = await this.repository.findById(command.returnId)
    if (orderReturn === null) {
      throw new NotFoundError({ returnId: command.returnId }, ErrorCode.RETURN_NOT_FOUND, 'Return not found')
    }
    const feeDiram = await this.deliveryPort.calculateReturnFee(command.tenantId, command.orderId)
    const fee = Money.fromDiram(feeDiram)
    orderReturn.markInTransit(command.courierId, fee)

    await this.unitOfWork.run(async (tx) => {
      await this.repository.save(orderReturn, tx)
      await this.outbox.append(
        command.tenantId,
        {
          type: 'ReturnInTransitEvent',
          returnId: orderReturn.id,
          orderId: orderReturn.orderId,
          courierId: command.courierId,
          courierReturnFeeDiram: fee.diram.toString(),
        },
        tx,
      )
    })
  }
}
