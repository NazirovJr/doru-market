/**
 * `FeatureFlag` (EP-15, DTJ-352, SRS-ADM-028). Единственная сущность СОБСТВЕННОГО домена
 * `modules/admin` — value object уровня «резолвинг по специфичности» (`02` §2 применяется
 * частично: приватный конструктор + фабрика, но без state machine, без методов-намерений —
 * запись целиком заменяется через `create()`, домен не мутирует состояние).
 *
 * `resolve()` — ЧИСТАЯ функция (C18, `04-SCOPE-DECISION-PIVOT.md`/`27-module-admin-moderation-
 * onboarding.md` §10.1): per-tenant запись побеждает global той же `flagKey`, отсутствие обеих —
 * `false` (безопасный дефолт, неизвестный/неопределённый флаг не считается включённым).
 * `candidates` ДОЛЖНЫ быть заранее отфильтрованы вызывающим кодом до записей ОДНОГО `flagKey`
 * (`FeatureFlagsRepositoryPort.findByKey`) — `resolve()` не фильтрует по ключу сам, только
 * выбирает специфичность среди уже переданных кандидатов.
 *
 * `create()` дублирует ОБА `CHECK`-инварианта БД (`chk_feature_flags_scope_tenant`,
 * `chk_feature_flags_rollout_range`, миграция `0046_feature_flags.sql`) — невалидное состояние
 * физически несконструируемо, ошибка домена бросается ДО того, как невалидные данные дойдут до
 * репозитория (`02` §2.2).
 */
import { ValidationError } from '@dorutj/contracts'
import type { FeatureFlagScope } from '@dorutj/contracts'

const MIN_ROLLOUT_PERCENTAGE = 0
const MAX_ROLLOUT_PERCENTAGE = 100

export interface FeatureFlagCreateCommand {
  readonly id: string
  readonly flagKey: string
  readonly scope: FeatureFlagScope
  readonly tenantId?: string | null
  readonly isEnabled: boolean
  readonly rolloutPercentage: number
  readonly description?: string | null
  readonly updatedBy?: string | null
}

export interface FeatureFlagSnapshot {
  readonly id: string
  readonly flagKey: string
  readonly scope: FeatureFlagScope
  readonly tenantId: string | null
  readonly isEnabled: boolean
  readonly rolloutPercentage: number
  readonly description: string | null
  readonly updatedBy: string | null
  readonly updatedAt: Date
}

export class FeatureFlag {
  private constructor(private readonly snapshot: FeatureFlagSnapshot) {}

  static create(command: FeatureFlagCreateCommand, now: Date): FeatureFlag {
    const tenantId = command.tenantId ?? null
    assertScopeTenantInvariant(command.scope, tenantId)
    assertRolloutPercentageInRange(command.rolloutPercentage)
    return new FeatureFlag({
      id: command.id,
      flagKey: command.flagKey,
      scope: command.scope,
      tenantId,
      isEnabled: command.isEnabled,
      rolloutPercentage: command.rolloutPercentage,
      description: command.description ?? null,
      updatedBy: command.updatedBy ?? null,
      updatedAt: now,
    })
  }

  /** Восстановление из уже валидной строки БД — без повторной валидации инварианта (`02` §2.2). */
  static restore(snapshot: FeatureFlagSnapshot): FeatureFlag {
    return new FeatureFlag(snapshot)
  }

  get id(): string {
    return this.snapshot.id
  }

  get flagKey(): string {
    return this.snapshot.flagKey
  }

  get scope(): FeatureFlagScope {
    return this.snapshot.scope
  }

  get tenantId(): string | null {
    return this.snapshot.tenantId
  }

  get isEnabled(): boolean {
    return this.snapshot.isEnabled
  }

  get rolloutPercentage(): number {
    return this.snapshot.rolloutPercentage
  }

  get description(): string | null {
    return this.snapshot.description
  }

  get updatedBy(): string | null {
    return this.snapshot.updatedBy
  }

  get updatedAt(): Date {
    return this.snapshot.updatedAt
  }

  toSnapshot(): FeatureFlagSnapshot {
    return this.snapshot
  }

  /** См. JSDoc файла — резолвинг специфичности. */
  static resolve(candidates: readonly FeatureFlag[]): boolean {
    const tenantMatch = candidates.find((flag) => flag.scope === 'tenant')
    if (tenantMatch !== undefined) {
      return tenantMatch.isEnabled
    }
    const globalMatch = candidates.find((flag) => flag.scope === 'global')
    return globalMatch?.isEnabled ?? false
  }
}

function assertScopeTenantInvariant(scope: FeatureFlagScope, tenantId: string | null): void {
  if (scope === 'tenant' && tenantId === null) {
    throw new ValidationError('tenantId is required when scope is "tenant" (SRS-ADM-028)', { scope })
  }
  if (scope === 'global' && tenantId !== null) {
    throw new ValidationError('tenantId must be empty when scope is "global" (SRS-ADM-028)', { scope, tenantId })
  }
}

function assertRolloutPercentageInRange(rolloutPercentage: number): void {
  if (rolloutPercentage < MIN_ROLLOUT_PERCENTAGE || rolloutPercentage > MAX_ROLLOUT_PERCENTAGE) {
    throw new ValidationError('rolloutPercentage must be between 0 and 100 (SRS-ADM-028)', { rolloutPercentage })
  }
}
