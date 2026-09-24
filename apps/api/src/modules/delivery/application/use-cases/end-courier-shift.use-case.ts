/**
 * `EndCourierShiftUseCase` (EP-13, DTJ-320, SRS-DELIV-029) — `POST /api/v1/courier-shifts/:id/end`.
 *
 * `CourierShift.close()` (DTJ-313) вычисляет `discrepancy_diram` и, если `!= 0`, кладёт
 * `CashReconciliationDiscrepancyEvent` в буфер сущности (`pullDomainEvents()`) — этот use case
 * публикует его через `DeliveryOutboxPort` В ТОЙ ЖЕ транзакции, что и сохранение `CourierShift`/
 * `Courier` (DoD: закрытие смены не блокируется недоступностью audit_log-сервиса — запись строго
 * локальная, `outbox`-таблица той же БД, не сетевой вызов; материализация в `audit_log` — ниже по
 * течению, вне периметра этого тикета, см. JSDoc `DeliveryOutboxPort`).
 *
 * Ownership: `:id` — id смены, RBAC требует «только сам курьер, над СВОЕЙ сменой» (текст тикета
 * п.3) — `ForbiddenError`, если `shift.courierId !== resolvedCourier.id` (1:1 приём
 * `retry-payment.use-case.ts`/`create-support-ticket.use-case.ts`: чужой ресурс → `ForbiddenError`,
 * не молчаливый `NotFoundError` — тот же прецедент уже есть в этой кодовой базе).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { CourierShiftSnapshot } from '../../domain/courier-shift.entity.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  COURIER_SHIFT_REPOSITORY,
  type CourierShiftRepositoryPort,
} from '../ports/courier-shift.repository.port.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

/** Re-export для `presentation` (`courier-shift-view.dto.ts`) — `02` §1.1: presentation не имеет
 * права импортировать `domain/*` напрямую (`dependency-cruiser`
 * `presentation-goes-through-application`, обнаружено при сдаче DTJ-321 — foundIssue DTJ-320,
 * этот модуль ни разу не прогонялся через `arch:check` до этой правки), только через application. */
export type { CourierShiftSnapshot }

export interface EndCourierShiftInput {
  readonly userId: string
  readonly shiftId: string
  readonly cashSubmittedDiram: bigint
}

@Injectable()
export class EndCourierShiftUseCase {
  /** 6 DI-инъекций, NestJS constructor injection резолвит по позиции (C5 недостижим без сокрытия
   * графа зависимостей за анонимной фабрикой), тот же приём, что `checkout.use-case.ts`. */
  // eslint-disable-next-line max-params -- см. JSDoc выше
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(COURIER_SHIFT_REPOSITORY) private readonly shifts: CourierShiftRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(input: EndCourierShiftInput): Promise<CourierShiftSnapshot> {
    return this.uow.run(async (tx) => {
      const courier = await this.couriers.findByUserId(input.userId, tx)
      if (courier === null) {
        throw new NotFoundError({ userId: input.userId })
      }
      const shift = await this.shifts.findById(input.shiftId, tx)
      if (shift === null) {
        throw new NotFoundError({ shiftId: input.shiftId })
      }
      if (shift.courierId !== courier.id) {
        throw new ForbiddenError('Shift does not belong to the requesting courier', { shiftId: input.shiftId })
      }
      const hasActiveAssignment = await this.assignments.hasActiveAssignmentForCourier(courier.id, tx)
      shift.close({
        cashSubmittedDiram: Money.fromDiram(input.cashSubmittedDiram),
        hasActiveAssignment,
        closedBy: null,
        now: this.clock.now(),
      })
      const updatedCourier = courier.goOffShift().settleCashOnHand()
      await this.shifts.save(shift, tx)
      await this.couriers.save(updatedCourier, tx)
      // ОДНА транзакция (`tx`, ОДНО pg-соединение) — `Promise.all` не параллелит запись outbox,
      // только рискует переупорядочить события (1:1 приём `submit-courier-rating.use-case.ts`).
      for (const event of shift.pullDomainEvents()) {
        // eslint-disable-next-line no-await-in-loop -- см. комментарий выше
        await this.outbox.append(event, null, tx)
      }
      return shift.toSnapshot()
    })
  }
}
