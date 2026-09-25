// PUT: закрывает текущую открытую строку и вставляет новую в одной транзакции (история ставок,
// не перезапись). Роль — super_admin-only (сужено от SRS `pharmacy_admin`-условия — нет порта
// delivery->onboarding для is_whitelabel_active, см. отчёт сдачи).
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { DeliveryPricingRule } from '@/modules/delivery/domain/delivery-pricing-rule.entity.js'
import {
  DELIVERY_PRICING_RULE_REPOSITORY,
  type DeliveryPricingRuleRepositoryPort,
} from '../ports/delivery-pricing-rule.repository.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

export type { DeliveryPricingRule }

const SUPER_ADMIN_ROLE = 'super_admin'
// TODO(DTJ-322): нет своей category в audit_action_category enum — временно 'ledger_adjustment' (см. отчёт сдачи).
const AUDIT_CATEGORY = 'ledger_adjustment'
const AUDIT_ENTITY_TYPE = 'delivery_pricing_rule'
const AUDIT_ACTION = 'delivery_pricing_rule_put'

export interface DeliveryPricingActor {
  readonly userId: string
  readonly role: string
}

export interface PutDeliveryPricingRuleCommand {
  readonly tenantId: string
  readonly zoneId: string | null
  readonly baseRateDiram: bigint
  readonly ratePerKmDiram: bigint
  readonly minOrderAmountDiram: bigint
  readonly freeDeliveryThresholdDiram: bigint | null
  readonly nightTariffStartTime: string | null
  readonly nightTariffEndTime: string | null
  readonly nightTariffExtraDiram: bigint
  readonly actor: DeliveryPricingActor
}

@Injectable()
export class ManageDeliveryPricingRulesUseCase {
  // eslint-disable-next-line max-params -- 5 DI-инъекций, конструктор NestJS.
  public constructor(
    @Inject(DELIVERY_PRICING_RULE_REPOSITORY) private readonly rules: DeliveryPricingRuleRepositoryPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async getCurrent(tenantId: string, zoneId: string | null, actor: DeliveryPricingActor): Promise<DeliveryPricingRule | null> {
    assertSuperAdmin(actor)
    return this.rules.findOpen(tenantId, zoneId)
  }

  public async put(cmd: PutDeliveryPricingRuleCommand): Promise<DeliveryPricingRule> {
    assertSuperAdmin(cmd.actor)
    const now = this.clock.now()
    const created = await this.uow.run(async (tx) => {
      const open = await this.rules.findOpen(cmd.tenantId, cmd.zoneId, tx)
      if (open !== null) {
        await this.rules.save(open.close(now), tx)
      }
      const rule = DeliveryPricingRule.create({
        id: this.ids.next(),
        tenantId: cmd.tenantId,
        zoneId: cmd.zoneId,
        baseRateDiram: Money.fromDiram(cmd.baseRateDiram),
        ratePerKmDiram: Money.fromDiram(cmd.ratePerKmDiram),
        minOrderAmountDiram: Money.fromDiram(cmd.minOrderAmountDiram),
        freeDeliveryThresholdDiram: cmd.freeDeliveryThresholdDiram === null ? null : Money.fromDiram(cmd.freeDeliveryThresholdDiram),
        nightTariffStartTime: cmd.nightTariffStartTime,
        nightTariffEndTime: cmd.nightTariffEndTime,
        nightTariffExtraDiram: Money.fromDiram(cmd.nightTariffExtraDiram),
        effectiveFrom: now,
      })
      await this.rules.save(rule, tx)
      return rule
    })
    await this.auditLog.write({
      category: AUDIT_CATEGORY,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: created.id,
      actorUserId: cmd.actor.userId,
      action: AUDIT_ACTION,
      metadata: { extra: { crossTenantOverride: true, tenantId: cmd.tenantId, zoneId: cmd.zoneId } },
      requestId: null,
      tenantId: cmd.tenantId,
    })
    return created
  }
}

function assertSuperAdmin(actor: DeliveryPricingActor): void {
  if (actor.role !== SUPER_ADMIN_ROLE) {
    throw new ForbiddenError('ManageDeliveryPricingRulesUseCase requires super_admin actor', { actorRole: actor.role })
  }
}
