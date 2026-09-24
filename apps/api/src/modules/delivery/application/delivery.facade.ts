/**
 * `DeliveryFacade` (EP-13, DTJ-314, SRS-DELIV-001) — ЕДИНСТВЕННАЯ разрешённая точка входа для
 * других модулей (`orders`, `payments`, `billing`, `returns`) в модуль `delivery`
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). Прямой импорт `modules/delivery/domain/*`/
 * `application/*` из другого модуля — блокирующее нарушение (`dependency-cruiser`
 * `no-cross-module-deep-import`, DoD этого тикета).
 *
 * `assign`/`reassign` принимают `courierId` (не `CourierAssignmentEligibility` — это домен-
 * внутренний тип): фасад САМ резолвит курьера через `CourierRepositoryPort` и строит снапшот
 * приемлемости (`Courier.toEligibilitySnapshot()`), вызывающий код не обязан знать структуру
 * `CourierAssignmentEligibility`. `orderPharmacyChainId` — параметр вызывающего кода (DTJ-315+):
 * этот тикет не заводит `OrdersFacade`-зависимость (вне `files_owned`), заказ уже несёт эти данные
 * в обработчике `OrderPickedUpEvent`.
 *
 * `calculateDeliveryFee`/`assignReturnCourier` — ЗАГЛУШКИ (см. их JSDoc ниже, риски тикета):
 * сигнатуры стабильны для потребителей (`orders` checkout волна 6, `returns` EP-11) с первого
 * дня, полная реализация — DTJ-322 и DTJ-273/274 соответственно (вне R1-скоупа ЭТОГО тикета).
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock, type GeoPoint } from '@/shared-kernel/index.js'
import { DeliveryAssignment } from '../domain/delivery-assignment.entity.js'
import type { Courier } from '../domain/courier.entity.js'
import type { DeliveryAssignmentSnapshot } from '../domain/delivery-assignment-snapshot.js'
import {
  COURIER_REPOSITORY,
  type CourierRepositoryPort,
} from './ports/courier.repository.port.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from './ports/delivery-assignment.repository.port.js'

/** TODO(DTJ-322): формула по зонам/тарифам тенанта (SRS-DELIV-048). Заглушка — риски DTJ-314:
 * `orders`/checkout (волна 6) вызывает этот метод РАНЬШЕ готовности DTJ-322 (волна 9). Значение
 * НЕ финальное — override только через `DELIVERY_FEE_FIXED_STUB_DIRAM` (диагностика/тесты). */
const FIXED_DELIVERY_FEE_STUB_DIRAM = 1000n

export interface CreateDeliveryAssignmentInput {
  readonly id: string
  readonly orderId: string
  readonly landmarkText: string | null
  readonly requiresColdChain: boolean
}

export interface ReturnCourierAssignment {
  readonly courierId: string
  readonly etaMinutes: number | null
}

/** `reassign()` — объект-параметр (C5 max-params, 4 позиционных были бы за пределами лимита). */
export interface ReassignDeliveryInput {
  readonly assignmentId: string
  readonly newCourierId: string
  readonly reason: string
  readonly reassignedBy: string
}

@Injectable()
export class DeliveryFacade {
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** SRS-DELIV-037 — вызывается обработчиком `OrderPickedUpEvent` (DTJ-315), не этим тикетом. */
  public async createAssignment(input: CreateDeliveryAssignmentInput): Promise<DeliveryAssignmentSnapshot> {
    const existing = await this.assignments.findActiveByOrderId(input.orderId)
    const result = DeliveryAssignment.create({
      id: input.id,
      orderId: input.orderId,
      landmarkText: input.landmarkText,
      requiresColdChain: input.requiresColdChain,
      hasActiveNonTerminalAssignment: existing !== null,
      now: this.clock.now(),
    })
    if (!result.ok) {
      throw result.error
    }
    await this.assignments.save(result.value)
    return result.value.toSnapshot()
  }

  /** SRS-DOM-037/038 guards — enforced внутри `DeliveryAssignment.assign()` (DTJ-313). */
  public async assign(assignmentId: string, courierId: string, orderPharmacyChainId: string | null): Promise<void> {
    const assignment = await this.getAssignmentOrThrow(assignmentId)
    const courier = await this.getCourierOrThrow(courierId)
    assignment.assign({ courier: courier.toEligibilitySnapshot(), orderPharmacyChainId, now: this.clock.now() })
    await this.assignments.save(assignment)
  }

  /** SRS-DOM-041 — `reason` обязателен, проверяется доменом (`DeliveryAssignment.reassign()`). */
  public async reassign(input: ReassignDeliveryInput): Promise<void> {
    const assignment = await this.getAssignmentOrThrow(input.assignmentId)
    assignment.reassign({
      newCourierId: input.newCourierId,
      reason: input.reason,
      reassignedBy: input.reassignedBy,
      now: this.clock.now(),
    })
    await this.assignments.save(assignment)
  }

  /** SRS-DOM-036 — нетерминальный статус (`status NOT IN ('delivered','delivery_failed')`). */
  public async hasActiveAssignment(orderId: string): Promise<boolean> {
    return (await this.assignments.findActiveByOrderId(orderId)) !== null
  }

  public async getActiveAssignment(orderId: string): Promise<DeliveryAssignmentSnapshot | null> {
    const assignment = await this.assignments.findActiveByOrderId(orderId)
    return assignment?.toSnapshot() ?? null
  }

  /** TODO(DTJ-322) — см. JSDoc константы `FIXED_DELIVERY_FEE_STUB_DIRAM` выше. */
  // eslint-disable-next-line @typescript-eslint/require-await -- async намеренно: контракт Promise<bigint> стабилен для будущей реальной реализации (network/DB), throw обязан стать rejected-промисом при её появлении
  public async calculateDeliveryFee(_pharmacyGeoPoint: GeoPoint, _deliveryGeoPoint: GeoPoint): Promise<bigint> {
    const override = process.env.DELIVERY_FEE_FIXED_STUB_DIRAM
    if (override !== undefined && override.trim() !== '') {
      const parsed = BigInt(override)
      return parsed
    }
    return FIXED_DELIVERY_FEE_STUB_DIRAM
  }

  /**
   * Заглушка (DTJ-314, риски) — используется `returns` (EP-11) через `ReturnsDeliveryPort`
   * (адаптер — DTJ-273/274, вне периметра этого тикета). `null` здесь означает буквально то же,
   * что и в целевом контракте (`ReturnsDeliveryPort.assignReturnCourier` JSDoc): «курьер обратного
   * рейса ещё не назначен/недоступен» — валидное, не ошибочное значение.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- см. calculateDeliveryFee выше, та же причина
  public async assignReturnCourier(_tenantId: string, _returnId: string): Promise<ReturnCourierAssignment | null> {
    return null
  }

  private async getAssignmentOrThrow(assignmentId: string): Promise<DeliveryAssignment> {
    const assignment = await this.assignments.findById(assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ assignmentId })
    }
    return assignment
  }

  private async getCourierOrThrow(courierId: string): Promise<Courier> {
    const courier = await this.couriers.findById(courierId)
    if (courier === null) {
      throw new NotFoundError({ courierId })
    }
    return courier
  }
}
