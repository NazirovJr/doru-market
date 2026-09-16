/**
 * `ListFeatureFlagsUseCase` (EP-15, DTJ-352) — `GET /api/v1/feature-flags`. Курсорная пагинация
 * (`SRS-API-004`, `@dorutj/contracts` `cursorQuerySchema`), сортировка по умолчанию
 * `flagKey:asc, id:asc` — детерминированный keyset без зависимости от `updatedAt` (который
 * мутируется каждым `PATCH`, что сделало бы курсор нестабильным между страницами).
 *
 * Возвращает ПЛОСКИЙ `FeatureFlagView` (application-слой), НЕ доменный `FeatureFlag` —
 * `presentation` не имеет права импортировать `domain/` даже транзитивно через тип результата
 * use case (`dependency-cruiser` `presentation-goes-through-application`, `02` §1.1, тот же приём,
 * что `toSupportTicketListItem` в `support`-модуле). `toFeatureFlagView` экспортирован —
 * переиспользуется `upsert-feature-flag.use-case.ts`.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { FeatureFlagScope } from '@dorutj/contracts'
import type { FeatureFlag } from '../../domain/feature-flag.entity.js'
import {
  FEATURE_FLAGS_REPOSITORY,
  type FeatureFlagsListCursor,
  type FeatureFlagsRepositoryPort,
} from '../ports/feature-flags-repository.port.js'

export interface ListFeatureFlagsCommand {
  readonly limit: number
  readonly cursor?: FeatureFlagsListCursor | null
}

export interface FeatureFlagView {
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

export interface ListFeatureFlagsResult {
  readonly items: readonly FeatureFlagView[]
  readonly nextCursor: FeatureFlagsListCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class ListFeatureFlagsUseCase {
  public constructor(@Inject(FEATURE_FLAGS_REPOSITORY) private readonly repository: FeatureFlagsRepositoryPort) {}

  public async execute(command: ListFeatureFlagsCommand): Promise<ListFeatureFlagsResult> {
    const page = await this.repository.list({ limit: command.limit, cursor: command.cursor ?? null })
    return { items: page.items.map(toFeatureFlagView), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }
}

export function toFeatureFlagView(flag: FeatureFlag): FeatureFlagView {
  return {
    id: flag.id,
    flagKey: flag.flagKey,
    scope: flag.scope,
    tenantId: flag.tenantId,
    isEnabled: flag.isEnabled,
    rolloutPercentage: flag.rolloutPercentage,
    description: flag.description,
    updatedBy: flag.updatedBy,
    updatedAt: flag.updatedAt,
  }
}
