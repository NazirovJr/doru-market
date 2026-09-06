/**
 * `RejectReturnUseCase` (EP-11, DTJ-273, SRS-DOM-056). Фармацевт отклоняет приёмку возврата
 * (упаковка/содержимое не совпадает с описанием и т.п.) — `return_in_transit → return_rejected`,
 * НЕ терминален: `AdminOverrideReturnUseCase`/`RetryReturnTransitUseCase` могут перевести дальше.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ErrorCode, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { RETURNS_REPOSITORY, type ReturnsRepositoryPort } from '../ports/returns-repository.port.js'
import { RETURNS_UNIT_OF_WORK, type ReturnsUnitOfWorkPort } from '../ports/returns-unit-of-work.port.js'
import { RETURNS_OUTBOX, type ReturnsOutboxPort } from '../ports/returns-outbox.port.js'

export interface RejectReturnCommand {
  readonly tenantId: string
  readonly returnId: string
  readonly reason: string
}

@Injectable()
export class RejectReturnUseCase {
  // eslint-disable-next-line max-params -- явный @Inject на каждом порте (граф зависимостей виден в providers[]), см. CreateSupportTicketUseCase JSDoc.
  public constructor(
    @Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort,
    @Inject(RETURNS_UNIT_OF_WORK) private readonly unitOfWork: ReturnsUnitOfWorkPort,
    @Inject(RETURNS_OUTBOX) private readonly outbox: ReturnsOutboxPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: RejectReturnCommand): Promise<void> {
    const orderReturn = await this.repository.findById(command.returnId)
    if (orderReturn === null) {
      throw new NotFoundError({ returnId: command.returnId }, ErrorCode.RETURN_NOT_FOUND, 'Return not found')
    }
    orderReturn.reject(command.reason, this.clock.now())

    await this.unitOfWork.run(async (tx) => {
      await this.repository.save(orderReturn, tx)
      await this.outbox.append(
        command.tenantId,
        {
          type: 'ReturnRejectedEvent',
          returnId: orderReturn.id,
          orderId: orderReturn.orderId,
          rejectionReason: command.reason,
        },
        tx,
      )
    })
  }
}
