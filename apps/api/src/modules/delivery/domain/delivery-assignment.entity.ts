/**
 * `DeliveryAssignment` — корень агрегата (EP-13, DTJ-313, `10-domain-model.md`
 * §«Delivery (DeliveryAssignment)», `25-module-courier-delivery.md`).
 *
 * Приватный конструктор + фабрика (`02` §2.2), состояние — мутируемые приватные поля +
 * `_domainEvents`/`pullDomainEvents()` (тот же приём, что `modules/orders/domain/order.entity.ts` —
 * ближайший образец: оба агрегата — сложная многошаговая state machine с методами-намерениями).
 * Переходы — `delivery-assignment.state-machine.ts` (`assertTransition`), кроме `reassign()`
 * (bespoke-guard, см. JSDoc там же).
 */
import {
  CashAmountMismatchError,
  ColdChainBagNotConfirmedError,
  CourierNotEligibleError,
  CourierTenantMismatchError,
  DuplicateActiveDeliveryAssignmentError,
  ForbiddenTransitionError,
  ValidationError,
  type DeliveryAssignmentStatus,
  type DomainError,
} from '@dorutj/contracts'
import { err, ok, type Result } from '@dorutj/domain-kernel'
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { DeliveryAssignmentCreateCommand } from './delivery-assignment-create-command.js'
import type { DeliveryAssignmentSnapshot } from './delivery-assignment-snapshot.js'
import type { DeliveryDomainEvent } from './delivery-domain-event.js'
import { isDeliveryAssignmentTransitionAllowed, isReassignableStatus } from './delivery-assignment.state-machine.js'

/** Курьер, каким его видит `assign()` — снимок, не вся сущность `Courier` (агрегаты ссылаются
 * друг на друга по id, не embedding, `02` §1.1). */
export interface CourierAssignmentEligibility {
  readonly courierId: string
  readonly courierChainId: string | null
  readonly coldChainCertified: boolean
}

/** `assign()` — сгруппировано в команду ради `max-params` (C5, ≤3). */
export interface AssignCourierCommand {
  readonly courier: CourierAssignmentEligibility
  readonly orderPharmacyChainId: string | null
  readonly now: Date
}

/** `reassign()` — сгруппировано в команду ради `max-params` (C5, ≤3). */
export interface ReassignCommand {
  readonly newCourierId: string
  readonly reason: string
  readonly reassignedBy: string
  readonly now: Date
}

export class DeliveryAssignment {
  readonly id: string
  readonly orderId: string
  readonly createdAt: Date

  private _courierId: string | null
  private _status: DeliveryAssignmentStatus
  private _landmarkText: string | null
  private _handoverOtpId: string | null
  private _cashCollectedDiram: Money | null
  private _cashChangeDiram: Money | null
  private _reassignReason: string | null
  private _reassignedBy: string | null
  private _assignedAt: Date | null
  private _pickedUpFromPharmacyAt: Date | null
  private _deliveredAt: Date | null
  private _failedReason: string | null
  private _requiresColdChain: boolean
  private _coldChainBagConfirmed: boolean | null
  private _coldChainBagConfirmedAt: Date | null
  private _contactAttemptsCount: number
  private _lastContactAttemptAt: Date | null
  private _distanceMeters: number | null
  private _domainEvents: DeliveryDomainEvent[] = []

  private constructor(s: DeliveryAssignmentSnapshot) {
    this.id = s.id
    this.orderId = s.orderId
    this.createdAt = s.createdAt
    this._courierId = s.courierId
    this._status = s.status
    this._landmarkText = s.landmarkText
    this._handoverOtpId = s.handoverOtpId
    this._cashCollectedDiram = s.cashCollectedDiram
    this._cashChangeDiram = s.cashChangeDiram
    this._reassignReason = s.reassignReason
    this._reassignedBy = s.reassignedBy
    this._assignedAt = s.assignedAt
    this._pickedUpFromPharmacyAt = s.pickedUpFromPharmacyAt
    this._deliveredAt = s.deliveredAt
    this._failedReason = s.failedReason
    this._requiresColdChain = s.requiresColdChain
    this._coldChainBagConfirmed = s.coldChainBagConfirmed
    this._coldChainBagConfirmedAt = s.coldChainBagConfirmedAt
    this._contactAttemptsCount = s.contactAttemptsCount
    this._lastContactAttemptAt = s.lastContactAttemptAt
    this._distanceMeters = s.distanceMeters
  }

  get status(): DeliveryAssignmentStatus {
    return this._status
  }

  get courierId(): string | null {
    return this._courierId
  }

  /** SRS-DOM-036 — `hasActiveNonTerminalAssignment` уже проверен вызывающим кодом через порт
   * (см. JSDoc команды); АС3 тикета: дубль отклоняется без обращения к БД в этом тесте. */
  static create(cmd: DeliveryAssignmentCreateCommand): Result<DeliveryAssignment, DomainError> {
    if (cmd.hasActiveNonTerminalAssignment) {
      return err(new DuplicateActiveDeliveryAssignmentError({ orderId: cmd.orderId }))
    }
    return ok(
      new DeliveryAssignment({
        id: cmd.id,
        orderId: cmd.orderId,
        courierId: null,
        status: 'unassigned',
        landmarkText: cmd.landmarkText,
        handoverOtpId: null,
        cashCollectedDiram: null,
        cashChangeDiram: null,
        reassignReason: null,
        reassignedBy: null,
        assignedAt: null,
        pickedUpFromPharmacyAt: null,
        deliveredAt: null,
        failedReason: null,
        createdAt: cmd.now,
        requiresColdChain: cmd.requiresColdChain,
        coldChainBagConfirmed: null,
        coldChainBagConfirmedAt: null,
        contactAttemptsCount: 0,
        lastContactAttemptAt: null,
        distanceMeters: null,
      }),
    )
  }

  /** Восстановление из снимка (репозиторий, DTJ-314+) — без повторной валидации создания. */
  static restore(snapshot: DeliveryAssignmentSnapshot): DeliveryAssignment {
    return new DeliveryAssignment(snapshot)
  }

  /** `unassigned → assigned` (SRS-DOM-137/SRS-DELIV-016/033/038 — алгоритм/`claim`/`assign-manual`
   * все сходятся сюда). SRS-DOM-037/038 — единственные guard'ы, принадлежащие ЭТОМУ агрегату;
   * `off_shift`/загрузка курьера — application-слой (`SuggestNearestCourierUseCase`, DTJ-314+). */
  assign(cmd: AssignCourierCommand): void {
    this.assertTransition('assigned')
    const { courier, orderPharmacyChainId } = cmd
    if (courier.courierChainId !== null && courier.courierChainId !== orderPharmacyChainId) {
      throw new CourierTenantMismatchError({ courierId: courier.courierId, orderPharmacyChainId })
    }
    if (this._requiresColdChain && !courier.coldChainCertified) {
      throw new CourierNotEligibleError({ courierId: courier.courierId, reason: 'cold_chain_not_certified' })
    }
    this._status = 'assigned'
    this._courierId = courier.courierId
    this._assignedAt = cmd.now
  }

  /** `assigned → en_route_to_pharmacy` (SRS-DELIV-019, «Выехал»). Только назначенный курьер —
   * проверка actor'а (`assignment.courierId !== actor.courierId` → 403) — application/guard, не домен. */
  depart(): void {
    this.assertTransition('en_route_to_pharmacy')
    this._status = 'en_route_to_pharmacy'
  }

  /** `en_route_to_pharmacy → picked_up_from_pharmacy` (SRS-DOM-140) — заказ переведён в
   * `order.status='picked_up'`, OTP сгенерирован (оба — вызывающий use case, не эта сущность). */
  markPickedUpFromPharmacy(now: Date): void {
    this.assertTransition('picked_up_from_pharmacy')
    this._status = 'picked_up_from_pharmacy'
    this._pickedUpFromPharmacyAt = now
  }

  /** `picked_up_from_pharmacy → en_route_to_customer` (SRS-DELIV-020). */
  departToCustomer(coldChainBagConfirmed: boolean, now: Date): void {
    this.assertTransition('en_route_to_customer')
    if (this._requiresColdChain && !coldChainBagConfirmed) {
      throw new ColdChainBagNotConfirmedError({ deliveryAssignmentId: this.id })
    }
    this._status = 'en_route_to_customer'
    this._coldChainBagConfirmed = coldChainBagConfirmed
    this._coldChainBagConfirmedAt = now
  }

  /** SRS-DOM-040/SRS-DELIV-021 — предусловие `markDelivered()` для `cash_courier`. Не меняет
   * статус (не переход) — данные могут записываться до финального `deliver`. */
  recordCash(collectedDiram: Money, changeDiram: Money, orderTotalDiram: Money): void {
    if (!collectedDiram.subtract(changeDiram).equals(orderTotalDiram)) {
      throw new CashAmountMismatchError({
        deliveryAssignmentId: this.id,
        collectedDiram: collectedDiram.diram.toString(),
        changeDiram: changeDiram.diram.toString(),
        orderTotalDiram: orderTotalDiram.diram.toString(),
      })
    }
    this._cashCollectedDiram = collectedDiram
    this._cashChangeDiram = changeDiram
  }

  /** `en_route_to_customer → delivered` (SRS-DOM-039/142). Верификация `OtpCode` — вызывающий
   * use case (см. JSDoc `delivery-assignment-create-command.ts` §2.6 — приём готового результата). */
  markDelivered(now: Date, isCashOnDelivery: boolean): void {
    this.assertTransition('delivered')
    if (isCashOnDelivery && this._cashCollectedDiram === null) {
      throw new CashAmountMismatchError({ deliveryAssignmentId: this.id, reason: 'cash_not_recorded' })
    }
    this._status = 'delivered'
    this._deliveredAt = now
  }

  /** `en_route_to_customer → delivery_failed` (SRS-DOM-143). */
  markFailed(reason: string, now: Date): void {
    this.assertTransition('delivery_failed')
    this._status = 'delivery_failed'
    this._failedReason = reason
    void now
    this._domainEvents.push({
      type: 'DeliveryFailedEvent',
      deliveryAssignmentId: this.id,
      orderId: this.orderId,
      reason,
      contactAttemptsCount: this._contactAttemptsCount,
    })
  }

  /** SRS-DOM-041/SRS-DELIV-034 — bespoke-guard (см. JSDoc `state-machine.ts`), не таблица переходов.
   * Сбрасывает накопленный прогресс к старту потока (`assignedAt`=now, `pickedUpFromPharmacyAt`/
   * `coldChainBagConfirmed*`=null) — диаграмма источника моделирует reassign как «снятие + заново»
   * (курьер физически новый, обязан начать с выезда к аптеке), не сохранение прогресса старого. */
  reassign(cmd: ReassignCommand): void {
    if (!isReassignableStatus(this._status)) {
      this.throwInvalidTransition('assigned', 'reassign() requires a non-terminal, already-assigned stage')
    }
    if (cmd.reason.trim() === '') {
      throw new ValidationError('reason is required for reassignment', { field: 'reason' })
    }
    this._status = 'assigned'
    this._courierId = cmd.newCourierId
    this._assignedAt = cmd.now
    this._pickedUpFromPharmacyAt = null
    this._coldChainBagConfirmed = null
    this._coldChainBagConfirmedAt = null
    this._reassignReason = cmd.reason
    this._reassignedBy = cmd.reassignedBy
  }

  /** SRS-DELIV-025 — попытка связаться с клиентом (НЕ используется `report-issue
   * { issueType: 'address_not_found' }`, см. SRS-DELIV-043). */
  recordContactAttempt(now: Date): void {
    this._contactAttemptsCount += 1
    this._lastContactAttemptAt = now
  }

  /** D.2 — снапшот дистанции аптека→клиент на момент создания (аудит `delivery_fee`), заполняется
   * вызывающим use case сразу после `create()` (не часть команды создания — требует `GeoPoint`). */
  setDistanceSnapshot(distanceMeters: number): void {
    this._distanceMeters = distanceMeters
  }

  setHandoverOtp(otpId: string): void {
    this._handoverOtpId = otpId
  }

  pullDomainEvents(): DeliveryDomainEvent[] {
    const events = this._domainEvents
    this._domainEvents = []
    return events
  }

  toSnapshot(): DeliveryAssignmentSnapshot {
    return {
      id: this.id,
      orderId: this.orderId,
      courierId: this._courierId,
      status: this._status,
      landmarkText: this._landmarkText,
      handoverOtpId: this._handoverOtpId,
      cashCollectedDiram: this._cashCollectedDiram,
      cashChangeDiram: this._cashChangeDiram,
      reassignReason: this._reassignReason,
      reassignedBy: this._reassignedBy,
      assignedAt: this._assignedAt,
      pickedUpFromPharmacyAt: this._pickedUpFromPharmacyAt,
      deliveredAt: this._deliveredAt,
      failedReason: this._failedReason,
      createdAt: this.createdAt,
      requiresColdChain: this._requiresColdChain,
      coldChainBagConfirmed: this._coldChainBagConfirmed,
      coldChainBagConfirmedAt: this._coldChainBagConfirmedAt,
      contactAttemptsCount: this._contactAttemptsCount,
      lastContactAttemptAt: this._lastContactAttemptAt,
      distanceMeters: this._distanceMeters,
    }
  }

  /** Единственная точка проверки «естественного» перехода (`state-machine.ts`). */
  private assertTransition(to: DeliveryAssignmentStatus): void {
    if (!isDeliveryAssignmentTransitionAllowed(this._status, to)) {
      this.throwInvalidTransition(to)
    }
  }

  private throwInvalidTransition(to: DeliveryAssignmentStatus, reason?: string): never {
    throw new ForbiddenTransitionError({ deliveryAssignmentId: this.id, from: this._status, to, reason })
  }
}
