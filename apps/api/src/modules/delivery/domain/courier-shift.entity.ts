/**
 * `CourierShift` — история физических смен курьера (EP-13, DTJ-313, `25-module-courier-delivery.md`
 * §D.4, SRS-DELIV-006). Разделяет «признание заработка» (`courier_earnings`, вне периметра этого
 * тикета) от «физического учёта наличных на руках».
 *
 * `discrepancyDiram` — обычный `bigint`, НЕ `Money`: разница может быть ОТРИЦАТЕЛЬНОЙ (курьер сдал
 * больше, чем должен был), а `Money.fromDiram` запрещает отрицательные суммы конструктором
 * (`10-domain-model.md` SRS-DOM-067 — знаковые величины кодируются вне `Money`, не отрицательным
 * инстансом).
 */
import {
  ActiveAssignmentBlocksShiftEndError,
  ShiftAlreadyActiveError,
  type CourierShiftRecordStatus,
} from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { DeliveryDomainEvent } from './delivery-domain-event.js'

const ZERO_DIRAM = 0n

export interface CourierShiftStartCommand {
  readonly id: string
  readonly courierId: string
  readonly openingCashOnHandDiram: Money
  readonly hasActiveShift: boolean
  readonly now: Date
}

/** `close()` — сгруппировано в команду ради `max-params` (C5, ≤3). */
export interface CourierShiftCloseCommand {
  readonly cashSubmittedDiram: Money
  readonly hasActiveAssignment: boolean
  readonly closedBy: string | null
  readonly now: Date
}

export interface CourierShiftSnapshot {
  readonly id: string
  readonly courierId: string
  readonly status: CourierShiftRecordStatus
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly openingCashOnHandDiram: Money
  readonly cashCollectedDiram: Money
  readonly cashSubmittedDiram: Money | null
  readonly discrepancyDiram: bigint | null
  readonly closedBy: string | null
  readonly notes: string | null
}

export class CourierShift {
  readonly id: string
  readonly courierId: string
  readonly startedAt: Date
  readonly openingCashOnHandDiram: Money

  private _status: CourierShiftRecordStatus
  private _endedAt: Date | null
  private _cashCollectedDiram: Money
  private _cashSubmittedDiram: Money | null
  private _discrepancyDiram: bigint | null
  private _closedBy: string | null
  private _notes: string | null
  private _domainEvents: DeliveryDomainEvent[] = []

  private constructor(s: CourierShiftSnapshot) {
    this.id = s.id
    this.courierId = s.courierId
    this.startedAt = s.startedAt
    this.openingCashOnHandDiram = s.openingCashOnHandDiram
    this._status = s.status
    this._endedAt = s.endedAt
    this._cashCollectedDiram = s.cashCollectedDiram
    this._cashSubmittedDiram = s.cashSubmittedDiram
    this._discrepancyDiram = s.discrepancyDiram
    this._closedBy = s.closedBy
    this._notes = s.notes
  }

  get status(): CourierShiftRecordStatus {
    return this._status
  }
  get cashCollectedDiram(): Money {
    return this._cashCollectedDiram
  }
  get discrepancyDiram(): bigint | null {
    return this._discrepancyDiram
  }

  /** SRS-DELIV-028 — `hasActiveShift` уже проверен вызывающим кодом через `ux_courier_shifts_one_active`
   * (тот же приём defensive-домен-теста, что `DeliveryAssignment.create()`/SRS-DOM-036). */
  static start(cmd: CourierShiftStartCommand): CourierShift {
    if (cmd.hasActiveShift) {
      throw new ShiftAlreadyActiveError({ courierId: cmd.courierId })
    }
    return new CourierShift({
      id: cmd.id,
      courierId: cmd.courierId,
      status: 'active',
      startedAt: cmd.now,
      endedAt: null,
      openingCashOnHandDiram: cmd.openingCashOnHandDiram,
      cashCollectedDiram: Money.fromDiram(ZERO_DIRAM),
      cashSubmittedDiram: null,
      discrepancyDiram: null,
      closedBy: null,
      notes: null,
    })
  }

  static restore(snapshot: CourierShiftSnapshot): CourierShift {
    return new CourierShift(snapshot)
  }

  /** SRS-DELIV-021 — вызывается синхронно с `DeliveryAssignment.recordCash()`/`Courier.addCashOnHand()`
   * в одной прикладной транзакции (эта сущность не знает про транзакции — `02` §2.6). */
  recordCashCollected(amountDiram: Money): void {
    this._cashCollectedDiram = this._cashCollectedDiram.add(amountDiram)
  }

  /** SRS-DELIV-029 — `active → closed`. `discrepancy = collected + opening - submitted`;
   * `!= 0` эмитирует `CashReconciliationDiscrepancyEvent` (НЕ блокирует закрытие). */
  close(cmd: CourierShiftCloseCommand): void {
    if (cmd.hasActiveAssignment) {
      throw new ActiveAssignmentBlocksShiftEndError({ courierShiftId: this.id })
    }
    const discrepancy =
      this._cashCollectedDiram.diram + this.openingCashOnHandDiram.diram - cmd.cashSubmittedDiram.diram
    this._status = 'closed'
    this._endedAt = cmd.now
    this._cashSubmittedDiram = cmd.cashSubmittedDiram
    this._discrepancyDiram = discrepancy
    this._closedBy = cmd.closedBy
    if (discrepancy !== ZERO_DIRAM) {
      this._domainEvents.push({
        type: 'CashReconciliationDiscrepancyEvent',
        courierShiftId: this.id,
        courierId: this.courierId,
        discrepancyDiram: discrepancy,
      })
    }
  }

  pullDomainEvents(): DeliveryDomainEvent[] {
    const events = this._domainEvents
    this._domainEvents = []
    return events
  }

  toSnapshot(): CourierShiftSnapshot {
    return {
      id: this.id,
      courierId: this.courierId,
      status: this._status,
      startedAt: this.startedAt,
      endedAt: this._endedAt,
      openingCashOnHandDiram: this.openingCashOnHandDiram,
      cashCollectedDiram: this._cashCollectedDiram,
      cashSubmittedDiram: this._cashSubmittedDiram,
      discrepancyDiram: this._discrepancyDiram,
      closedBy: this._closedBy,
      notes: this._notes,
    }
  }
}
