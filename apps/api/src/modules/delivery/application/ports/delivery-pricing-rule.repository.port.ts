import type { DeliveryPricingRule } from '../../domain/delivery-pricing-rule.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const DELIVERY_PRICING_RULE_REPOSITORY = Symbol.for('@dorutj/delivery/delivery-pricing-rule-repository')

export interface FindEffectivePricingRuleQuery {
  readonly tenantId: string | null
  readonly zoneId: string | null
  readonly atDate: string // YYYY-MM-DD, Asia/Dushanbe
}

export interface DeliveryPricingRuleRepositoryPort {
  // Точный ключ (tenantId, zoneId) на atDate, без фолбэка — фолбэк делает use case.
  findEffective(query: FindEffectivePricingRuleQuery, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryPricingRule | null>
  // Текущая открытая строка (effective_to IS NULL) — PUT закрывает её перед вставкой новой.
  findOpen(tenantId: string, zoneId: string | null, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryPricingRule | null>
  save(rule: DeliveryPricingRule, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
