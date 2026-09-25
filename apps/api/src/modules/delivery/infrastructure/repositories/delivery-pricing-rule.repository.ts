import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { deliveryPricingRules, type DeliveryPricingRuleRow } from '@/db/schema/delivery-pricing-rules.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import {
  DeliveryPricingRule,
  type DeliveryPricingRuleProps,
} from '@/modules/delivery/domain/delivery-pricing-rule.entity.js'
import {
  DELIVERY_PRICING_RULE_REPOSITORY,
  type DeliveryPricingRuleRepositoryPort,
  type FindEffectivePricingRuleQuery,
} from '@/modules/delivery/application/ports/delivery-pricing-rule.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleDeliveryPricingRuleRepository implements DeliveryPricingRuleRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findEffective(query: FindEffectivePricingRuleQuery, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryPricingRule | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client
      .select()
      .from(deliveryPricingRules)
      .where(
        and(
          tenantMatch(query.tenantId),
          zoneMatch(query.zoneId),
          lte(deliveryPricingRules.effectiveFrom, query.atDate),
          or(isNull(deliveryPricingRules.effectiveTo), gt(deliveryPricingRules.effectiveTo, query.atDate)),
        ),
      )
      .orderBy(desc(deliveryPricingRules.effectiveFrom))
      .limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findOpen(tenantId: string, zoneId: string | null, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryPricingRule | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client
      .select()
      .from(deliveryPricingRules)
      .where(and(eq(deliveryPricingRules.tenantId, tenantId), zoneMatch(zoneId), isNull(deliveryPricingRules.effectiveTo)))
      .limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async save(rule: DeliveryPricingRule, tx?: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const row = toRow(rule)
    await client.insert(deliveryPricingRules).values(row).onConflictDoUpdate({ target: deliveryPricingRules.id, set: row })
  }
}

function tenantMatch(tenantId: string | null) {
  return tenantId === null ? isNull(deliveryPricingRules.tenantId) : eq(deliveryPricingRules.tenantId, tenantId)
}

function zoneMatch(zoneId: string | null) {
  return zoneId === null ? isNull(deliveryPricingRules.zoneId) : eq(deliveryPricingRules.zoneId, zoneId)
}

function toDomain(row: DeliveryPricingRuleRow): DeliveryPricingRule {
  const props: DeliveryPricingRuleProps = {
    id: row.id,
    tenantId: row.tenantId,
    zoneId: row.zoneId,
    baseRateDiram: Money.fromDiram(row.baseRateDiram),
    ratePerKmDiram: Money.fromDiram(row.ratePerKmDiram),
    minOrderAmountDiram: Money.fromDiram(row.minOrderAmountDiram),
    freeDeliveryThresholdDiram: row.freeDeliveryThresholdDiram === null ? null : Money.fromDiram(row.freeDeliveryThresholdDiram),
    nightTariffStartTime: row.nightTariffStartTime,
    nightTariffEndTime: row.nightTariffEndTime,
    nightTariffExtraDiram: Money.fromDiram(row.nightTariffExtraDiram),
    effectiveFrom: new Date(row.effectiveFrom),
    effectiveTo: row.effectiveTo === null ? null : new Date(row.effectiveTo),
  }
  return DeliveryPricingRule.restore(props)
}

function toRow(rule: DeliveryPricingRule): typeof deliveryPricingRules.$inferInsert {
  const p = rule.props
  return {
    id: rule.id,
    tenantId: p.tenantId,
    zoneId: p.zoneId,
    baseRateDiram: p.baseRateDiram.diram,
    ratePerKmDiram: p.ratePerKmDiram.diram,
    minOrderAmountDiram: p.minOrderAmountDiram.diram,
    freeDeliveryThresholdDiram: p.freeDeliveryThresholdDiram?.diram ?? null,
    nightTariffStartTime: p.nightTariffStartTime,
    nightTariffEndTime: p.nightTariffEndTime,
    nightTariffExtraDiram: p.nightTariffExtraDiram.diram,
    effectiveFrom: toDateString(p.effectiveFrom),
    effectiveTo: p.effectiveTo === null ? null : toDateString(p.effectiveTo),
  }
}

/** Календарная дата в Asia/Dushanbe (`YYYY-MM-DD`, D-19) — ТОТ ЖЕ сдвиг `+5:00`, что
 * `CalculateDeliveryFeeUseCase::toDushanbeDateString` использует при сравнении с этими же
 * колонками; несогласованный UTC-срез дал бы расхождение на дату у момента 19:00-24:00 UTC. */
function toDateString(d: Date): string {
  const DUSHANBE_UTC_OFFSET_HOURS = 5
  const MS_PER_HOUR = 3_600_000
  return new Date(d.getTime() + DUSHANBE_UTC_OFFSET_HOURS * MS_PER_HOUR).toISOString().slice(0, 10)
}

export const DELIVERY_PRICING_RULE_REPOSITORY_PROVIDER = {
  provide: DELIVERY_PRICING_RULE_REPOSITORY,
  useClass: DrizzleDeliveryPricingRuleRepository,
} as const
