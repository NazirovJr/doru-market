/**
 * `UpsertFeatureFlagUseCase` (EP-15, DTJ-352) — обслуживает И `POST /api/v1/feature-flags`
 * (`command.id` не задан → генерируется `IdGenerator`), И `PATCH /api/v1/feature-flags/:id`
 * (`command.id` — из маршрута). Одна команда/один класс на ОБА эндпоинта — не "два use case,
 * отличающихся только присутствием id" (C15): доменная валидация (`FeatureFlag.create`) и
 * pre-check конфликта идентичны в обоих случаях.
 *
 * `assertNoConflict` — обязателен ПЕРЕД `repository.upsert()`: `upsert` пишет по PK `id`
 * (`ON CONFLICT (id) DO UPDATE`, см. JSDoc порта), поэтому САМ по себе не поймает вторую запись
 * с ТЕМ ЖЕ `(flagKey, scope, tenantId)`, но ДРУГИМ `id` — а для `scope='global'` реальный
 * `UNIQUE`-констрейнт БД тоже не поймает (два `NULL` в `tenant_id` не конфликтуют по SQL-
 * стандарту). Этот pre-check — единственная защита от такого дубля.
 *
 * `updated_by = actor.userId` — пишется БЕЗУСЛОВНО (ticket «Что сделать» п.5: `reason` explicit
 * НЕ требуется спецификацией, но `updated_by` — да).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ConflictError, type FeatureFlagScope } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { ID_GENERATOR, type IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'
import { FeatureFlag } from '../../domain/feature-flag.entity.js'
import { FEATURE_FLAGS_REPOSITORY, type FeatureFlagsRepositoryPort } from '../ports/feature-flags-repository.port.js'
import { toFeatureFlagView, type FeatureFlagView } from './list-feature-flags.use-case.js'

export interface UpsertFeatureFlagCommand {
  /** Присутствует ТОЛЬКО для `PATCH` (обновление существующей записи по `id` из маршрута). */
  readonly id?: string
  readonly flagKey: string
  readonly scope: FeatureFlagScope
  readonly tenantId?: string | null
  readonly isEnabled: boolean
  readonly rolloutPercentage: number
  readonly description?: string | null
  readonly actor: { readonly userId: string }
}

@Injectable()
export class UpsertFeatureFlagUseCase {
  public constructor(
    @Inject(FEATURE_FLAGS_REPOSITORY) private readonly repository: FeatureFlagsRepositoryPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(command: UpsertFeatureFlagCommand): Promise<FeatureFlagView> {
    const tenantId = command.tenantId ?? null
    await this.assertNoConflict(command, tenantId)
    const entity = FeatureFlag.create(
      {
        id: command.id ?? this.ids.next(),
        flagKey: command.flagKey,
        scope: command.scope,
        tenantId,
        isEnabled: command.isEnabled,
        rolloutPercentage: command.rolloutPercentage,
        description: command.description ?? null,
        updatedBy: command.actor.userId,
      },
      this.clock.now(),
    )
    const saved = await this.repository.upsert(entity)
    return toFeatureFlagView(saved)
  }

  /** См. JSDoc файла — pre-check `UNIQUE(flag_key, scope, tenant_id)` до записи. */
  private async assertNoConflict(command: UpsertFeatureFlagCommand, tenantId: string | null): Promise<void> {
    const candidates = await this.repository.findByKey(command.flagKey, tenantId)
    const conflict = candidates.find((flag) => flag.scope === command.scope && flag.id !== command.id)
    if (conflict !== undefined) {
      throw new ConflictError('A feature flag with this key/scope/tenant already exists', {
        flagKey: command.flagKey,
        scope: command.scope,
        tenantId,
      })
    }
  }
}
