import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@dorutj/contracts'
import type { Clock, IdGenerator } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import { DeliveryPricingRule } from '../../domain/delivery-pricing-rule.entity.js'
import type { DeliveryPricingRuleRepositoryPort } from '../ports/delivery-pricing-rule.repository.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import { ManageDeliveryPricingRulesUseCase, type PutDeliveryPricingRuleCommand } from './manage-delivery-pricing-rules.use-case.js'

const TENANT_ID = 'tenant-1'
const NOW = new Date('2026-09-05T10:00:00.000Z')
const NEW_RULE_ID = 'rule-new'
const SUPER_ADMIN = { userId: 'admin-1', role: 'super_admin' }
const PHARMACY_ADMIN = { userId: 'pa-1', role: 'pharmacy_admin' }

function openRule(): DeliveryPricingRule {
  return DeliveryPricingRule.create({
    id: 'rule-old',
    tenantId: TENANT_ID,
    zoneId: null,
    baseRateDiram: Money.fromDiram(1000n),
    ratePerKmDiram: Money.fromDiram(200n),
    minOrderAmountDiram: Money.fromDiram(0n),
    freeDeliveryThresholdDiram: null,
    nightTariffStartTime: null,
    nightTariffEndTime: null,
    nightTariffExtraDiram: Money.fromDiram(0n),
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  })
}

interface Harness {
  readonly useCase: ManageDeliveryPricingRulesUseCase
  readonly saveMock: ReturnType<typeof vi.fn>
  readonly auditWrite: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { open?: DeliveryPricingRule | null } = {}): Harness {
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const rulesRepo: DeliveryPricingRuleRepositoryPort = {
    findEffective: vi.fn().mockResolvedValue(null),
    findOpen: vi.fn().mockResolvedValue(params.open === undefined ? openRule() : params.open),
    save: saveMock,
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const auditWrite = vi.fn().mockResolvedValue(undefined)
  const auditLog: AuditLogPort = { write: auditWrite }
  const ids: IdGenerator = { next: vi.fn(() => NEW_RULE_ID) }
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new ManageDeliveryPricingRulesUseCase(rulesRepo, uow, auditLog, ids, clock),
    saveMock,
    auditWrite,
  }
}

function basePutCommand(overrides: Partial<PutDeliveryPricingRuleCommand> = {}): PutDeliveryPricingRuleCommand {
  return {
    tenantId: TENANT_ID,
    zoneId: null,
    baseRateDiram: 1500n,
    ratePerKmDiram: 250n,
    minOrderAmountDiram: 0n,
    freeDeliveryThresholdDiram: null,
    nightTariffStartTime: null,
    nightTariffEndTime: null,
    nightTariffExtraDiram: 0n,
    actor: SUPER_ADMIN,
    ...overrides,
  }
}

describe('ManageDeliveryPricingRulesUseCase — SRS-DELIV-036 (история ставок, PUT не перезаписывает)', () => {
  it('put: закрывает текущую открытую строку и создаёт новую с effectiveFrom=now()', async () => {
    const { useCase, saveMock } = makeUseCase()
    const created = await useCase.put(basePutCommand())

    expect(created.id).toBe(NEW_RULE_ID)
    expect(created.effectiveTo).toBeNull()
    expect(saveMock).toHaveBeenCalledTimes(2)
    const [closedArg] = saveMock.mock.calls[0] as [DeliveryPricingRule]
    expect(closedArg.id).toBe('rule-old')
    expect(closedArg.effectiveTo).toEqual(NOW)
  })

  it('put: нет текущей открытой строки -> сохраняет только новую (одна вставка)', async () => {
    const { useCase, saveMock } = makeUseCase({ open: null })
    await useCase.put(basePutCommand())
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it('put: пишет audit_log с crossTenantOverride=true после успешной транзакции', async () => {
    const { useCase, auditWrite } = makeUseCase()
    await useCase.put(basePutCommand())
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delivery_pricing_rule_put',
        tenantId: TENANT_ID,
        metadata: { extra: { crossTenantOverride: true, tenantId: TENANT_ID, zoneId: null } },
      }),
    )
  })

  it('put: не super_admin -> ForbiddenError, ничего не сохраняется', async () => {
    const { useCase, saveMock } = makeUseCase()
    await expect(useCase.put(basePutCommand({ actor: PHARMACY_ADMIN }))).rejects.toBeInstanceOf(ForbiddenError)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('getCurrent: не super_admin -> ForbiddenError', async () => {
    const { useCase } = makeUseCase()
    await expect(useCase.getCurrent(TENANT_ID, null, PHARMACY_ADMIN)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('getCurrent: возвращает открытую строку для ключа (tenantId, zoneId)', async () => {
    const { useCase } = makeUseCase()
    const current = await useCase.getCurrent(TENANT_ID, null, SUPER_ADMIN)
    expect(current?.id).toBe('rule-old')
  })
})
