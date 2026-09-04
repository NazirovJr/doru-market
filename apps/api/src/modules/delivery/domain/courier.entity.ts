/**
 * `Courier` — корень агрегата (EP-13, DTJ-313, `11-database-schema.md` §32,
 * `25-module-courier-delivery.md` D.1). Приватный конструктор + фабрика (`02` §2.2), props-объект
 * (тот же приём, что `modules/onboarding/domain/pharmacy-chain.entity.ts` — методы-намерения
 * возвращают НОВЫЙ инстанс, не мутируют `this`).
 */
import {
  NoActiveShiftError,
  ShiftAlreadyActiveError,
  ValidationError,
  type CourierShiftStatus,
  type CourierStatus,
  type CourierTaxStatus,
  type CourierVehicleType,
} from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { CourierAssignmentEligibility } from './delivery-assignment.entity.js'

const ZERO_DIRAM = 0n
const DEFAULT_RATING_AVG = 5
const RATING_MIN = 1
const RATING_MAX = 5
const RATING_DECIMALS = 100 // NUMERIC(3,2) — округление до 2 знаков (не money, обычный number).

/** Последняя известная точка курьера (SRS-DELIV-003) — `point`+`capturedAt` всегда обновляются
 * вместе, VO-пара вместо трёх раздельных примитивов (`02` §2.3, primitive obsession). */
export interface CourierLocationFix {
  readonly point: GeoPoint
  readonly capturedAt: Date
}

export interface CourierCreateCommand {
  readonly id: string
  readonly userId: string
  readonly chainId: string | null
  readonly taxStatus: CourierTaxStatus
  readonly vehicleType: CourierVehicleType
  /** `Clock.now()` — домен не вызывает `new Date()` напрямую (`02` §2.6). */
  readonly now: Date
}

export interface CourierProps {
  readonly id: string
  readonly userId: string
  readonly chainId: string | null
  readonly status: CourierStatus
  readonly taxStatus: CourierTaxStatus
  readonly taxStatusDocumentUrl: string | null
  readonly vehicleType: CourierVehicleType
  readonly coldChainCertified: boolean
  readonly healthCertificateUrl: string | null
  readonly verifiedBy: string | null
  readonly verifiedAt: Date | null
  readonly createdAt: Date
  readonly lastKnownLocation: CourierLocationFix | null
  readonly shiftStatus: CourierShiftStatus
  readonly ratingAvg: number
  readonly ratingCount: number
  readonly currentCashOnHandDiram: Money
}

export class Courier {
  private constructor(public readonly props: CourierProps) {}

  get id(): string {
    return this.props.id
  }
  get chainId(): string | null {
    return this.props.chainId
  }
  get status(): CourierStatus {
    return this.props.status
  }
  get coldChainCertified(): boolean {
    return this.props.coldChainCertified
  }
  get shiftStatus(): CourierShiftStatus {
    return this.props.shiftStatus
  }
  get ratingAvg(): number {
    return this.props.ratingAvg
  }
  get ratingCount(): number {
    return this.props.ratingCount
  }
  get currentCashOnHandDiram(): Money {
    return this.props.currentCashOnHandDiram
  }
  get lastKnownLocation(): CourierLocationFix | null {
    return this.props.lastKnownLocation
  }

  /** Регистрация (REQ-COUR-1..11) — начинает `pending_verification`, не может быть назначен
   * (SRS-DOM-137/REQ-COUR-10, guard живёт в `DeliveryAssignment.assign()`-вызывающем use case). */
  static create(cmd: CourierCreateCommand): Courier {
    return new Courier({
      id: cmd.id,
      userId: cmd.userId,
      chainId: cmd.chainId,
      status: 'pending_verification',
      taxStatus: cmd.taxStatus,
      taxStatusDocumentUrl: null,
      vehicleType: cmd.vehicleType,
      coldChainCertified: false,
      healthCertificateUrl: null,
      verifiedBy: null,
      verifiedAt: null,
      createdAt: cmd.now,
      lastKnownLocation: null,
      shiftStatus: 'off_shift',
      ratingAvg: DEFAULT_RATING_AVG,
      ratingCount: 0,
      currentCashOnHandDiram: Money.fromDiram(ZERO_DIRAM),
    })
  }

  static restore(props: CourierProps): Courier {
    return new Courier(props)
  }

  /** SRS-DELIV-027 — обновляет координаты, ТОЛЬКО если `capturedAt` новее уже сохранённого
   * (защита от переупорядочивания батча офлайн-очереди). Молча no-op на устаревшей точке — не
   * ошибка (см. модуль 25 §A.2: устаревшие точки пачки пропускаются, не отклоняются). */
  updateLocation(fix: CourierLocationFix): Courier {
    if (this.props.lastKnownLocation !== null && fix.capturedAt <= this.props.lastKnownLocation.capturedAt) {
      return this
    }
    return new Courier({ ...this.props, lastKnownLocation: fix })
  }

  /** SRS-DELIV-028 — `off_shift → on_shift`. */
  goOnShift(): Courier {
    if (this.props.shiftStatus === 'on_shift') {
      throw new ShiftAlreadyActiveError({ courierId: this.id })
    }
    return new Courier({ ...this.props, shiftStatus: 'on_shift' })
  }

  /** SRS-DELIV-029 — `on_shift → off_shift`. Наличные обнуляются ОТДЕЛЬНО, `settleCashOnHand()`
   * (закрытие смены — сдача/инкассация, application-слой решает порядок в транзакции). */
  goOffShift(): Courier {
    return new Courier({ ...this.props, shiftStatus: 'off_shift' })
  }

  /** SRS-DELIV-021 — курьер обязан быть на смене, чтобы принимать наличные за доставку. */
  addCashOnHand(amountDiram: Money): Courier {
    if (this.props.shiftStatus === 'off_shift') {
      throw new NoActiveShiftError({ courierId: this.id })
    }
    return new Courier({ ...this.props, currentCashOnHandDiram: this.props.currentCashOnHandDiram.add(amountDiram) })
  }

  /** SRS-DELIV-029 — остаток передан/инкассирован при закрытии смены. */
  settleCashOnHand(): Courier {
    return new Courier({ ...this.props, currentCashOnHandDiram: Money.fromDiram(ZERO_DIRAM) })
  }

  /** SRS-DELIV-007 — скользящее среднее `(avg*count + rating) / (count+1)`, округление до 2
   * знаков (`NUMERIC(3,2)`). Не money — обычный `number`, округление явное и единообразное. */
  applyRating(rating: number): Courier {
    if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) {
      throw new ValidationError('Invalid rating: expected integer between 1 and 5', { field: 'rating' })
    }
    const newCount = this.props.ratingCount + 1
    const rawAvg = (this.props.ratingAvg * this.props.ratingCount + rating) / newCount
    const roundedAvg = Math.round(rawAvg * RATING_DECIMALS) / RATING_DECIMALS
    return new Courier({ ...this.props, ratingAvg: roundedAvg, ratingCount: newCount })
  }

  /** Снимок для `DeliveryAssignment.assign()` — агрегаты ссылаются друг на друга по id (`02` §1.1). */
  toEligibilitySnapshot(): CourierAssignmentEligibility {
    return {
      courierId: this.id,
      courierChainId: this.props.chainId,
      coldChainCertified: this.props.coldChainCertified,
    }
  }
}
