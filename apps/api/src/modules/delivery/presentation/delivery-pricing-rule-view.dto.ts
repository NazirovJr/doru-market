import type { DeliveryPricingRule } from '../application/use-cases/manage-delivery-pricing-rules.use-case.js'

export interface DeliveryPricingRuleViewDto {
  readonly id: string
  readonly tenantId: string | null
  readonly zoneId: string | null
  readonly baseRateDiram: number
  readonly ratePerKmDiram: number
  readonly minOrderAmountDiram: number
  readonly freeDeliveryThresholdDiram: number | null
  readonly nightTariffStartTime: string | null
  readonly nightTariffEndTime: string | null
  readonly nightTariffExtraDiram: number
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

export function toDeliveryPricingRuleViewDto(rule: DeliveryPricingRule): DeliveryPricingRuleViewDto {
  const p = rule.props
  return {
    id: rule.id,
    tenantId: p.tenantId,
    zoneId: rule.zoneId,
    baseRateDiram: Number(p.baseRateDiram.diram),
    ratePerKmDiram: Number(p.ratePerKmDiram.diram),
    minOrderAmountDiram: Number(p.minOrderAmountDiram.diram),
    freeDeliveryThresholdDiram: p.freeDeliveryThresholdDiram === null ? null : Number(p.freeDeliveryThresholdDiram.diram),
    nightTariffStartTime: p.nightTariffStartTime,
    nightTariffEndTime: p.nightTariffEndTime,
    nightTariffExtraDiram: Number(p.nightTariffExtraDiram.diram),
    effectiveFrom: p.effectiveFrom.toISOString(),
    effectiveTo: rule.effectiveTo === null ? null : rule.effectiveTo.toISOString(),
  }
}
