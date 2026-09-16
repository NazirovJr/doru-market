/**
 * Порт `FeatureFlagsRepositoryPort` (EP-15, DTJ-352).
 *
 * `findByKey(flagKey, tenantId?)` возвращает РОВНО candidate-набор для `FeatureFlag.resolve()`:
 * все строки `scope='global'` этого `flagKey` + строка `scope='tenant'` этого `flagKey` для
 * переданного `tenantId` (если есть). Два потребителя ОДНОГО метода (не абстракция «на будущее»,
 * C15): (1) резолвинг специфичности, (2) `UpsertFeatureFlagUseCase` использует его же как
 * pre-check `UNIQUE(flag_key, scope, tenant_id)` ДО `upsert()` — Postgres `UNIQUE` НЕ ловит
 * дубль `scope='global'` сам (два `NULL` в `tenant_id` не равны друг другу по стандарту SQL),
 * так что для `scope='global'` это единственная защита от дубля на уровне приложения.
 *
 * `upsert(entity)` — INSERT/UPDATE по PRIMARY KEY `id` (`ON CONFLICT (id) DO UPDATE`, тот же
 * приём, что `DrizzleSupportTicketsRepository.save`) — НЕ по составному ключу
 * `(flag_key, scope, tenant_id)`: `id` уже известен И для создания (сгенерирован
 * `IdGenerator` в use case), И для обновления (`:id` из `PATCH`-маршрута).
 */
import type { FeatureFlag } from '../../domain/feature-flag.entity.js'

export const FEATURE_FLAGS_REPOSITORY = Symbol.for('@dorutj/admin/feature-flags-repository')

export interface FeatureFlagsListCursor {
  readonly v: string
  readonly id: string
}

export interface FeatureFlagsListQuery {
  readonly limit: number
  readonly cursor?: FeatureFlagsListCursor | null
}

export interface FeatureFlagsListPage {
  readonly items: readonly FeatureFlag[]
  readonly nextCursor: FeatureFlagsListCursor | null
  readonly hasMore: boolean
}

export interface FeatureFlagsRepositoryPort {
  findByKey(flagKey: string, tenantId?: string | null): Promise<readonly FeatureFlag[]>
  list(query: FeatureFlagsListQuery): Promise<FeatureFlagsListPage>
  upsert(flag: FeatureFlag): Promise<FeatureFlag>
}
