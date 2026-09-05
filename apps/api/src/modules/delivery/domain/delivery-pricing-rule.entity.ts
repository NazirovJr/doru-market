/**
 * `DeliveryPricingRule` — правило тарификации доставки (EP-13, DTJ-313,
 * `25-module-courier-delivery.md` §D.6/§A.8, SRS-DELIV-008/048). Props-стиль.
 *
 * `chk_delivery_pricing_rates_nonneg` — ГАРАНТИРУЕТСЯ типом: все денежные поля — `Money`, чей
 * `fromDiram()` уже отклоняет отрицательные значения (SRS-DOM-067) — отдельная проверка здесь
 * была бы дублированием инварианта VO, не новым правилом.
 *
 * `computeFeeForDistance()` — ЧИСТЫЙ расчёт (шаги 3-7 SRS-DELIV-048) ДЛЯ УЖЕ РЕЗОЛВЛЕННОГО правила
 * и УЖЕ ВЫЧИСЛЕННОЙ дистанции. Резолюция «какое правило/какая зона» (шаги 1-2, репозиторий) и
 * `distanceKm = pharmacyGeoPoint.distanceTo(customerGeoPoint)` (шаг 4, нужны ДВЕ точки, которых
 * это правило не содержит) — `DeliveryFacade.calculateDeliveryFee` (application, DTJ-314+, вне
 * периметра этого тикета).
 */
import { DeliveryMinOrderNotMetError } from '@dorutj/contracts'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const ZERO_DIRAM = 0n

export interface DeliveryPricingRuleCreateCommand {
  readonly id: string
  readonly tenantId: string | null
  readonly zoneId: string | null
  readonly baseRateDiram: Money
  readonly ratePerKmDiram: Money
  readonly minOrderAmountDiram: Money
  readonly freeDeliveryThresholdDiram: Money | null
  readonly nightTariffStartTime: string | null
  readonly nightTariffEndTime: string | null
  readonly nightTariffExtraDiram: Money
  readonly effectiveFrom: Date
}

export interface DeliveryPricingRuleProps extends DeliveryPricingRuleCreateCommand {
  readonly effectiveTo: Date | null
}

export class DeliveryPricingRule {
  private constructor(public readonly props: DeliveryPricingRuleProps) {}

  get id(): string {
    return this.props.id
  }
  get zoneId(): string | null {
    return this.props.zoneId
  }
  get effectiveTo(): Date | null {
    return this.props.effectiveTo
  }

  static create(cmd: DeliveryPricingRuleCreateCommand): DeliveryPricingRule {
    return new DeliveryPricingRule({ ...cmd, effectiveTo: null })
  }

  static restore(props: DeliveryPricingRuleProps): DeliveryPricingRule {
    return new DeliveryPricingRule(props)
  }

  /** SRS-DELIV-036 — `PUT` создаёт новую строку и закрывает эту (история ставок не перезаписывается). */
  close(effectiveTo: Date): DeliveryPricingRule {
    return new DeliveryPricingRule({ ...this.props, effectiveTo })
  }

  /** SRS-DELIV-048 шаги 3, 5-7. `isNightTariff` — уже вычислен вызывающим кодом
   * (`ClockPort.nowInTenantTz()`, обработка диапазона через полночь — application, не домен). */
  computeFeeForDistance(distanceKm: number, itemsTotalDiram: Money, isNightTariff: boolean): Money {
    if (itemsTotalDiram.isLessThan(this.props.minOrderAmountDiram)) {
      throw new DeliveryMinOrderNotMetError({
        itemsTotalDiram: itemsTotalDiram.diram.toString(),
        minOrderAmountDiram: this.props.minOrderAmountDiram.diram.toString(),
      })
    }
    const threshold = this.props.freeDeliveryThresholdDiram
    if (threshold !== null && itemsTotalDiram.isGreaterThanOrEqual(threshold)) {
      return Money.fromDiram(ZERO_DIRAM)
    }
    const distanceFeeDiram = BigInt(Math.round(Number(this.props.ratePerKmDiram.diram) * distanceKm))
    let fee = this.props.baseRateDiram.add(Money.fromDiram(distanceFeeDiram))
    if (isNightTariff) {
      fee = fee.add(this.props.nightTariffExtraDiram)
    }
    return fee
  }
}
