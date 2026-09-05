import { describe, expect, it } from 'vitest'
import { DeliveryMinOrderNotMetError } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { fixedDate } from '@/modules/delivery/testing/fixtures/fixed-date.fixture.js'
import { DeliveryPricingRule } from './delivery-pricing-rule.entity.js'

const EFFECTIVE_FROM = fixedDate('2026-01-01T00:00:00.000Z')

function rule(overrides: {
  baseRateDiram?: bigint
  ratePerKmDiram?: bigint
  minOrderAmountDiram?: bigint
  freeDeliveryThresholdDiram?: bigint | null
  nightTariffExtraDiram?: bigint
} = {}): DeliveryPricingRule {
  return DeliveryPricingRule.create({
    id: 'rule-1',
    tenantId: 'tenant-1',
    zoneId: null,
    baseRateDiram: Money.fromDiram(overrides.baseRateDiram ?? 1000n),
    ratePerKmDiram: Money.fromDiram(overrides.ratePerKmDiram ?? 200n),
    minOrderAmountDiram: Money.fromDiram(overrides.minOrderAmountDiram ?? 0n),
    freeDeliveryThresholdDiram:
      overrides.freeDeliveryThresholdDiram === undefined
        ? null
        : overrides.freeDeliveryThresholdDiram === null
          ? null
          : Money.fromDiram(overrides.freeDeliveryThresholdDiram),
    nightTariffStartTime: null,
    nightTariffEndTime: null,
    nightTariffExtraDiram: Money.fromDiram(overrides.nightTariffExtraDiram ?? 0n),
    effectiveFrom: EFFECTIVE_FROM,
  })
}

describe('computeFeeForDistance() — SRS-DELIV-048', () => {
  it('TC-DELIV-026: baseRate=1000, ratePerKm=200, distance=3.4km, вне ночного окна → fee=1680', () => {
    const fee = rule().computeFeeForDistance(3.4, Money.fromDiram(10000n), false)
    expect(fee.diram).toBe(1680n) // 1000 + round(200*3.4) = 1000+680
  })

  it('TC-DELIV-024: itemsTotal=3000 < minOrderAmountDiram=5000 → DeliveryMinOrderNotMetError', () => {
    const r = rule({ minOrderAmountDiram: 5000n })
    expect(() => r.computeFeeForDistance(1, Money.fromDiram(3000n), false)).toThrow(DeliveryMinOrderNotMetError)
  })

  it('TC-DELIV-025: itemsTotal=60000 >= freeDeliveryThreshold=50000, ночь, nightExtra=1000 → fee=0 (перекрывает ночной тариф)', () => {
    const r = rule({ freeDeliveryThresholdDiram: 50000n, nightTariffExtraDiram: 1000n })
    const fee = r.computeFeeForDistance(3.4, Money.fromDiram(60000n), true)
    expect(fee.diram).toBe(0n)
  })

  it('ночной тариф добавляет nightTariffExtraDiram, когда бесплатная доставка не применяется', () => {
    const r = rule({ nightTariffExtraDiram: 500n })
    const fee = r.computeFeeForDistance(3.4, Money.fromDiram(10000n), true)
    expect(fee.diram).toBe(2180n) // 1680 + 500
  })

  it('itemsTotal ровно равен minOrderAmountDiram — не блокирует (>=, не >)', () => {
    const r = rule({ minOrderAmountDiram: 5000n })
    expect(() => r.computeFeeForDistance(1, Money.fromDiram(5000n), false)).not.toThrow()
  })
})

describe('close() — SRS-DELIV-036', () => {
  it('устанавливает effectiveTo, не мутирует исходный инстанс', () => {
    const original = rule()
    const closed = original.close(fixedDate('2026-06-01T00:00:00.000Z'))
    expect(original.effectiveTo).toBeNull()
    expect(closed.effectiveTo).toEqual(fixedDate('2026-06-01T00:00:00.000Z'))
  })
})

describe('getters/restore()', () => {
  it('id/zoneId доступны, restore() восстанавливает props', () => {
    const original = rule()
    expect(original.id).toBe('rule-1')
    expect(original.zoneId).toBeNull()
    const restored = DeliveryPricingRule.restore(original.props)
    expect(restored.props).toEqual(original.props)
  })
})
