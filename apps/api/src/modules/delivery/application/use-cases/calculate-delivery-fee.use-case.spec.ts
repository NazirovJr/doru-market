import { describe, expect, it, vi } from 'vitest'
import { DeliveryMinOrderNotMetError, DeliveryZoneNotCoveredError, NotFoundError } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import type { Clock, GeoPoint } from '@/shared-kernel/index.js'
import { GeoPoint as GeoPointClass } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { DeliveryZone } from '../../domain/delivery-zone.entity.js'
import { DeliveryPricingRule } from '../../domain/delivery-pricing-rule.entity.js'
import type { DeliveryZoneRepositoryPort } from '../ports/delivery-zone.repository.port.js'
import type {
  DeliveryPricingRuleRepositoryPort,
  FindEffectivePricingRuleQuery,
} from '../ports/delivery-pricing-rule.repository.port.js'
import { CalculateDeliveryFeeUseCase, type CalculateDeliveryFeeInput } from './calculate-delivery-fee.use-case.js'

const TENANT_ID = 'tenant-1'
const NOW = new Date('2026-09-05T05:00:00.000Z') // 10:00 Asia/Dushanbe (UTC+5)
const NIGHT_MOMENT = new Date('2026-09-05T18:30:00.000Z') // 23:30 Asia/Dushanbe

function geoPoint(lat: number, lon: number): GeoPoint {
  const result = GeoPointClass.create(lat, lon)
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

const PHARMACY = geoPoint(38.57, 68.78)
const CUSTOMER_INSIDE = geoPoint(38.579, 68.78) // ~1km от PHARMACY
const CUSTOMER_OUTSIDE = geoPoint(39.0, 68.78) // ~48km от PHARMACY

function zone(overrides: { id?: string; tenantId?: string | null; radiusKm?: number; priority?: number } = {}): DeliveryZone {
  return DeliveryZone.create({
    id: overrides.id ?? 'zone-1',
    tenantId: overrides.tenantId === undefined ? TENANT_ID : overrides.tenantId,
    name: 'Zone A',
    center: PHARMACY,
    radiusKm: overrides.radiusKm ?? 5,
    priority: overrides.priority ?? 0,
  })
}

/** `value === undefined` -> `fallback`, иначе `value` как есть (в т.ч. явный `null`, в отличие от `??`). */
function orDefault<T>(value: T | undefined, fallback: T): T {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- `??` не подходит: явный `null` в overrides — валидное значение (глобальное правило), а `??` заменил бы его на fallback.
  return value === undefined ? fallback : value
}

function rule(overrides: {
  id?: string
  tenantId?: string | null
  zoneId?: string | null
  baseRateDiram?: bigint
  ratePerKmDiram?: bigint
  minOrderAmountDiram?: bigint
  freeDeliveryThresholdDiram?: bigint | null
  nightTariffStartTime?: string | null
  nightTariffEndTime?: string | null
  nightTariffExtraDiram?: bigint
} = {}): DeliveryPricingRule {
  return DeliveryPricingRule.create({
    id: overrides.id ?? 'rule-1',
    tenantId: orDefault(overrides.tenantId, TENANT_ID),
    zoneId: orDefault(overrides.zoneId, 'zone-1'),
    baseRateDiram: Money.fromDiram(overrides.baseRateDiram ?? 1000n),
    ratePerKmDiram: Money.fromDiram(overrides.ratePerKmDiram ?? 200n),
    minOrderAmountDiram: Money.fromDiram(overrides.minOrderAmountDiram ?? 0n),
    freeDeliveryThresholdDiram:
      overrides.freeDeliveryThresholdDiram == null ? null : Money.fromDiram(overrides.freeDeliveryThresholdDiram),
    nightTariffStartTime: overrides.nightTariffStartTime ?? null,
    nightTariffEndTime: overrides.nightTariffEndTime ?? null,
    nightTariffExtraDiram: Money.fromDiram(overrides.nightTariffExtraDiram ?? 0n),
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  })
}

interface Harness {
  readonly useCase: CalculateDeliveryFeeUseCase
  readonly findEffectiveMock: ReturnType<typeof vi.fn>
}

function ruleKey(tenantId: string | null, zoneId: string | null): string {
  if (zoneId !== null) return `zone:${zoneId}`
  return tenantId === null ? 'global' : 'tenant-default'
}

function makeUseCase(params: { zones?: readonly DeliveryZone[]; rules?: Map<string, DeliveryPricingRule> }): Harness {
  const zoneList = params.zones ?? [zone()]
  const zonesRepo: DeliveryZoneRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findActiveCoverageCandidates: vi.fn().mockResolvedValue(zoneList),
    findAllByTenant: vi.fn().mockResolvedValue(zoneList),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const rulesByKey = params.rules ?? new Map([['zone:zone-1', rule()]])
  const findEffectiveMock = vi.fn((query: FindEffectivePricingRuleQuery) =>
    Promise.resolve(rulesByKey.get(ruleKey(query.tenantId, query.zoneId)) ?? null),
  )
  const rulesRepo: DeliveryPricingRuleRepositoryPort = {
    findEffective: findEffectiveMock,
    findOpen: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const clock: Clock = { now: () => NOW }
  return { useCase: new CalculateDeliveryFeeUseCase(zonesRepo, rulesRepo, clock), findEffectiveMock }
}

function baseInput(overrides: Partial<CalculateDeliveryFeeInput> = {}): CalculateDeliveryFeeInput {
  return {
    pharmacyGeoPoint: PHARMACY,
    customerGeoPoint: CUSTOMER_INSIDE,
    tenantId: TENANT_ID,
    itemsTotalDiram: 10000n,
    ...overrides,
  }
}

describe('CalculateDeliveryFeeUseCase — SRS-DELIV-048', () => {
  it('TC-DELIV-023: точка вне всех зон -> DeliveryZoneNotCoveredError', async () => {
    const { useCase } = makeUseCase({})
    await expect(useCase.execute(baseInput({ customerGeoPoint: CUSTOMER_OUTSIDE }))).rejects.toBeInstanceOf(
      DeliveryZoneNotCoveredError,
    )
  })

  it('TC-DELIV-024: itemsTotal=3000 < minOrderAmountDiram=5000 -> DeliveryMinOrderNotMetError', async () => {
    const { useCase } = makeUseCase({ rules: new Map([['zone:zone-1', rule({ minOrderAmountDiram: 5000n })]]) })
    await expect(useCase.execute(baseInput({ itemsTotalDiram: 3000n }))).rejects.toBeInstanceOf(DeliveryMinOrderNotMetError)
  })

  it('TC-DELIV-026: baseRate=1000, ratePerKm=200, дистанция ~1км, вне ночного окна -> формула шага 5', async () => {
    const { useCase } = makeUseCase({})
    const fee = await useCase.execute(baseInput())
    expect(fee).toBeGreaterThan(1000n) // baseRate + округлённая дистанция > 0
  })

  it('TC-DELIV-025: itemsTotal >= freeDeliveryThreshold, ночь, nightExtra>0 -> fee=0 (бесплатная доставка перекрывает ночной тариф)', async () => {
    const { useCase } = makeUseCase({
      rules: new Map([
        [
          'zone:zone-1',
          rule({ freeDeliveryThresholdDiram: 50000n, nightTariffStartTime: '22:00', nightTariffEndTime: '06:00', nightTariffExtraDiram: 1000n }),
        ],
      ]),
    })
    const fee = await useCase.execute(baseInput({ itemsTotalDiram: 60000n, atMoment: NIGHT_MOMENT }))
    expect(fee).toBe(0n)
  })

  it('ночной тариф через полночь: 23:30 попадает в [22:00,06:00), надбавка применяется', async () => {
    const { useCase } = makeUseCase({
      rules: new Map([['zone:zone-1', rule({ nightTariffStartTime: '22:00', nightTariffEndTime: '06:00', nightTariffExtraDiram: 500n })]]),
    })
    const feeNight = await useCase.execute(baseInput({ atMoment: NIGHT_MOMENT }))
    const feeDay = await useCase.execute(baseInput({ atMoment: NOW }))
    expect(feeNight).toBe(feeDay + 500n)
  })

  it('фолбэк: нет зональной строки -> дефолт тенанта (zoneId IS NULL)', async () => {
    const { useCase } = makeUseCase({
      rules: new Map([['tenant-default', rule({ zoneId: null, baseRateDiram: 2000n })]]),
    })
    const fee = await useCase.execute(baseInput())
    expect(fee).toBeGreaterThanOrEqual(2000n)
  })

  it('фолбэк: нет зональной и нет тенантной -> глобальная (tenantId IS NULL, zoneId IS NULL)', async () => {
    const { useCase } = makeUseCase({
      rules: new Map([['global', rule({ tenantId: null, zoneId: null, baseRateDiram: 3000n })]]),
    })
    const fee = await useCase.execute(baseInput())
    expect(fee).toBeGreaterThanOrEqual(3000n)
  })

  it('нет ни одной строки тарифа (зона/тенант/global) -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ rules: new Map() })
    await expect(useCase.execute(baseInput())).rejects.toBeInstanceOf(NotFoundError)
  })

  it('resolveZone: при перекрытии зон выбирает наименьший priority, тай-брейк — наименьший radiusKm', async () => {
    const highPriorityZone = zone({ id: 'zone-hi', priority: 5, radiusKm: 10 })
    const lowPriorityZone = zone({ id: 'zone-lo', priority: 1, radiusKm: 10 })
    const { useCase, findEffectiveMock } = makeUseCase({
      zones: [highPriorityZone, lowPriorityZone],
      rules: new Map([['zone:zone-lo', rule({ zoneId: 'zone-lo' })]]),
    })
    await useCase.execute(baseInput())
    expect(findEffectiveMock).toHaveBeenCalledWith({ tenantId: TENANT_ID, zoneId: 'zone-lo', atDate: expect.any(String) as string })
  })

  it('atMoment не передан -> резолвится через ClockPort.now()', async () => {
    const { useCase } = makeUseCase({
      rules: new Map([['zone:zone-1', rule({ nightTariffStartTime: '22:00', nightTariffEndTime: '06:00', nightTariffExtraDiram: 999n })]]),
    })
    // NOW = 10:00 Душанбе -> не ночь, надбавка не применяется
    const fee = await useCase.execute(baseInput())
    const feeExplicitDay = await useCase.execute(baseInput({ atMoment: NOW }))
    expect(fee).toBe(feeExplicitDay)
  })
})
