/**
 * `DeliveryZone` — зона ценообразования доставки (EP-13, DTJ-313, `25-module-courier-delivery.md`
 * §D.6, SRS-DELIV-008). Props-стиль (тот же приём, что `Courier`/`PharmacyChain`) — методы-намерения
 * возвращают новый инстанс.
 *
 * Зона — окружность (`center`+`radiusKm`), НЕ полигон (D-05, простейшая модель для MVP-масштаба
 * города, осознанное решение спеки, не упрощение этого тикета).
 */
import { ValidationError } from '@dorutj/contracts'
import type { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'

const METERS_PER_KM = 1000

export interface DeliveryZoneCreateCommand {
  readonly id: string
  readonly tenantId: string | null
  readonly name: string
  readonly center: GeoPoint
  readonly radiusKm: number
  readonly priority: number
}

export interface DeliveryZoneUpdate {
  readonly name?: string
  readonly center?: GeoPoint
  readonly radiusKm?: number
  readonly priority?: number
}

export interface DeliveryZoneProps {
  readonly id: string
  readonly tenantId: string | null
  readonly name: string
  readonly center: GeoPoint
  readonly radiusKm: number
  readonly priority: number
  readonly isActive: boolean
}

export class DeliveryZone {
  private constructor(public readonly props: DeliveryZoneProps) {}

  get id(): string {
    return this.props.id
  }
  get tenantId(): string | null {
    return this.props.tenantId
  }
  get radiusKm(): number {
    return this.props.radiusKm
  }
  get priority(): number {
    return this.props.priority
  }
  get isActive(): boolean {
    return this.props.isActive
  }

  /** `chk_delivery_zones_radius_positive`. `is_active` по умолчанию `true` (СРАЗУ покрывает
   * заказы после создания — тот же дефолт, что колонка БД). */
  static create(cmd: DeliveryZoneCreateCommand): DeliveryZone {
    assertPositiveRadius(cmd.radiusKm)
    return new DeliveryZone({
      id: cmd.id,
      tenantId: cmd.tenantId,
      name: cmd.name,
      center: cmd.center,
      radiusKm: cmd.radiusKm,
      priority: cmd.priority,
      isActive: true,
    })
  }

  static restore(props: DeliveryZoneProps): DeliveryZone {
    return new DeliveryZone(props)
  }

  /** SRS-DELIV-036 — `PATCH /delivery-zones/:id`, частичное обновление. */
  update(patch: DeliveryZoneUpdate): DeliveryZone {
    if (patch.radiusKm !== undefined) {
      assertPositiveRadius(patch.radiusKm)
    }
    return new DeliveryZone({ ...this.props, ...patch })
  }

  activate(): DeliveryZone {
    return new DeliveryZone({ ...this.props, isActive: true })
  }

  deactivate(): DeliveryZone {
    return new DeliveryZone({ ...this.props, isActive: false })
  }

  /** SRS-DELIV-008/SRS-DOM-073 — `true`, если `point` внутри окружности зоны (гаверсинус).
   * Полная резолюция «какая зона покрывает точку» (перекрытие, приоритет) — application-слой
   * (`DeliveryFacade.calculateDeliveryFee`, DTJ-314+); эта сущность отвечает только за СЕБЯ. */
  containsPoint(point: GeoPoint): boolean {
    const radiusMeters = this.props.radiusKm * METERS_PER_KM
    return this.props.center.distanceTo(point) <= radiusMeters
  }
}

function assertPositiveRadius(radiusKm: number): void {
  if (!(radiusKm > 0)) {
    throw new ValidationError('radiusKm must be positive', { field: 'radiusKm', value: radiusKm })
  }
}
