// Тарификация доставки по зонам/тарифам тенанта. Дата/время суток — Asia/Dushanbe, фиксированный
// сдвиг +5:00 (тот же приём, что postgres-pharmacy-map.adapter.ts::toDushanbeTimeOfDay).
import { Inject, Injectable } from '@nestjs/common'
import { DeliveryZoneNotCoveredError, NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock, type GeoPoint } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { DeliveryZone } from '@/modules/delivery/domain/delivery-zone.entity.js'
import type { DeliveryPricingRule } from '@/modules/delivery/domain/delivery-pricing-rule.entity.js'
import {
  DELIVERY_ZONE_REPOSITORY,
  type DeliveryZoneRepositoryPort,
} from '../ports/delivery-zone.repository.port.js'
import {
  DELIVERY_PRICING_RULE_REPOSITORY,
  type DeliveryPricingRuleRepositoryPort,
} from '../ports/delivery-pricing-rule.repository.port.js'

const METERS_PER_KM = 1000
const DUSHANBE_UTC_OFFSET_HOURS = 5
const MS_PER_HOUR = 3_600_000

export interface CalculateDeliveryFeeInput {
  readonly pharmacyGeoPoint: GeoPoint
  readonly customerGeoPoint: GeoPoint
  readonly tenantId: string
  readonly itemsTotalDiram: bigint
  /** `undefined` -> резолвится через `Clock.now()`. */
  readonly atMoment?: Date
}

@Injectable()
export class CalculateDeliveryFeeUseCase {
  public constructor(
    @Inject(DELIVERY_ZONE_REPOSITORY) private readonly zones: DeliveryZoneRepositoryPort,
    @Inject(DELIVERY_PRICING_RULE_REPOSITORY) private readonly rules: DeliveryPricingRuleRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(input: CalculateDeliveryFeeInput): Promise<bigint> {
    const atMoment = input.atMoment ?? this.clock.now()
    const zone = await this.resolveZone(input.tenantId, input.customerGeoPoint)
    const rule = await this.resolveRule(input.tenantId, zone.id, atMoment)
    const distanceKm = input.pharmacyGeoPoint.distanceTo(input.customerGeoPoint) / METERS_PER_KM
    const isNightTariff = isWithinNightTariff(atMoment, rule.props.nightTariffStartTime, rule.props.nightTariffEndTime)
    const fee = rule.computeFeeForDistance(distanceKm, Money.fromDiram(input.itemsTotalDiram), isNightTariff)
    return fee.diram
  }

  /** Приоритет: меньший `priority`, тай-брейк — меньший `radiusKm`. */
  private async resolveZone(tenantId: string, point: GeoPoint): Promise<DeliveryZone> {
    const candidates = await this.zones.findActiveCoverageCandidates(tenantId)
    const covering = candidates.filter((z) => z.containsPoint(point))
    const [best] = [...covering].sort((a, b) => a.priority - b.priority || a.radiusKm - b.radiusKm)
    if (best === undefined) {
      throw new DeliveryZoneNotCoveredError({ tenantId })
    }
    return best
  }

  /** Фолбэк: зональная -> дефолт тенанта -> глобальная. */
  private async resolveRule(tenantId: string, zoneId: string, atMoment: Date): Promise<DeliveryPricingRule> {
    const atDate = toDushanbeDateString(atMoment)
    const zoneRule = await this.rules.findEffective({ tenantId, zoneId, atDate })
    if (zoneRule !== null) {
      return zoneRule
    }
    const tenantDefault = await this.rules.findEffective({ tenantId, zoneId: null, atDate })
    if (tenantDefault !== null) {
      return tenantDefault
    }
    const global = await this.rules.findEffective({ tenantId: null, zoneId: null, atDate })
    if (global !== null) {
      return global
    }
    throw new NotFoundError({ tenantId, zoneId, reason: 'no delivery pricing rule configured (zone/tenant/global)' })
  }
}

/** `HH:MM:00` — совпадает по формату со строкой из Postgres `time`-колонки. */
function toDushanbeTimeOfDay(utcMoment: Date): string {
  const shifted = new Date(utcMoment.getTime() + DUSHANBE_UTC_OFFSET_HOURS * MS_PER_HOUR)
  const hours = String(shifted.getUTCHours()).padStart(2, '0')
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}:00`
}

function toDushanbeDateString(utcMoment: Date): string {
  const shifted = new Date(utcMoment.getTime() + DUSHANBE_UTC_OFFSET_HOURS * MS_PER_HOUR)
  return shifted.toISOString().slice(0, 10)
}

/** `[start, end)`, диапазон через полночь — `start > end`. */
function isWithinNightTariff(atMoment: Date, start: string | null, end: string | null): boolean {
  if (start === null || end === null) {
    return false
  }
  const now = toDushanbeTimeOfDay(atMoment)
  if (end >= start) {
    return now >= start && now < end
  }
  return now >= start || now < end
}
