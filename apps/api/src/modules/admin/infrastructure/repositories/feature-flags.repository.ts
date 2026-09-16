/**
 * `FeatureFlagsRepository` (EP-15, DTJ-352) — реализация `FeatureFlagsRepositoryPort` поверх
 * `feature_flags` (`db/schema/feature-flags.ts`).
 *
 * `findByKey` — `WHERE flag_key = X AND (scope = 'global' OR (scope = 'tenant' AND tenant_id =
 * :tenantId))`. Без `tenantId` (global-контекст вызова) фильтр вырождается в `scope = 'global'` —
 * candidate-набор ВСЕГДА ограничен ОДНИМ `flagKey` (см. JSDoc порта про два потребителя).
 *
 * `upsert` — `INSERT ... ON CONFLICT (id) DO UPDATE` (1:1 приём с
 * `DrizzleSupportTicketsRepository.save`), НЕ по составному `UNIQUE(flag_key, scope, tenant_id)` —
 * см. JSDoc порта про то, почему конфликт по составному ключу проверяется в use case, а не здесь.
 *
 * `list` — keyset-пагинация по `(flag_key, id)` ASC (не `updated_at`, см. JSDoc use case'а) —
 * `LIMIT input.limit + 1` даёт `hasMore` без второго `COUNT`-запроса (тот же приём, что
 * `DrizzleSupportTicketsRepository.list`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, gt, or, type SQL } from 'drizzle-orm'
import type { FeatureFlagScope } from '@dorutj/contracts'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { featureFlags, type FeatureFlagRow } from '@/db/schema/feature-flags.js'
import { FeatureFlag } from '@/modules/admin/domain/feature-flag.entity.js'
import {
  type FeatureFlagsListCursor,
  type FeatureFlagsListPage,
  type FeatureFlagsListQuery,
  type FeatureFlagsRepositoryPort,
  FEATURE_FLAGS_REPOSITORY,
} from '@/modules/admin/application/ports/feature-flags-repository.port.js'

@Injectable()
export class FeatureFlagsRepository implements FeatureFlagsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findByKey(flagKey: string, tenantId?: string | null): Promise<readonly FeatureFlag[]> {
    const rows = await this.db
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.flagKey, flagKey), scopeCondition(tenantId ?? null)))
    return rows.map(toDomain)
  }

  public async list(query: FeatureFlagsListQuery): Promise<FeatureFlagsListPage> {
    const cursorCondition = query.cursor != null ? keysetCondition(query.cursor) : undefined
    const rows = await this.db
      .select()
      .from(featureFlags)
      .where(cursorCondition)
      .orderBy(asc(featureFlags.flagKey), asc(featureFlags.id))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last !== undefined ? { v: last.flagKey, id: last.id } : null,
      hasMore,
    }
  }

  public async upsert(flag: FeatureFlag): Promise<FeatureFlag> {
    const row = toRow(flag)
    const [saved] = await this.db.insert(featureFlags).values(row).onConflictDoUpdate({ target: featureFlags.id, set: row }).returning()
    if (saved === undefined) {
      throw new Error('feature_flags upsert returned no row')
    }
    return toDomain(saved)
  }
}

/** Без `tenantId` — только `scope = 'global'`. С `tenantId` — global ИЛИ эта конкретная tenant-строка. */
function scopeCondition(tenantId: string | null): SQL {
  const globalCondition = eq(featureFlags.scope, 'global')
  if (tenantId === null) {
    return globalCondition
  }
  const tenantCondition = and(eq(featureFlags.scope, 'tenant'), eq(featureFlags.tenantId, tenantId))
  return or(globalCondition, tenantCondition) ?? globalCondition
}

function keysetCondition(cursor: FeatureFlagsListCursor): SQL | undefined {
  return or(gt(featureFlags.flagKey, cursor.v), and(eq(featureFlags.flagKey, cursor.v), gt(featureFlags.id, cursor.id)))
}

function toDomain(row: FeatureFlagRow): FeatureFlag {
  return FeatureFlag.restore({
    id: row.id,
    flagKey: row.flagKey,
    scope: row.scope as FeatureFlagScope,
    tenantId: row.tenantId,
    isEnabled: row.isEnabled,
    rolloutPercentage: row.rolloutPercentage,
    description: row.description,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  })
}

function toRow(flag: FeatureFlag): FeatureFlagRow {
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

export const FEATURE_FLAGS_REPOSITORY_PROVIDER = {
  provide: FEATURE_FLAGS_REPOSITORY,
  useClass: FeatureFlagsRepository,
} as const
