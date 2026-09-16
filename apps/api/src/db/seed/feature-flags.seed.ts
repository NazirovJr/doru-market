/**
 * Seed обязательных R1-флагов `feature_flags` (EP-15, DTJ-352, DoD п.5): `pnpm db:seed`
 * дополнение, НЕ отдельная миграция с данными (ticket «Что сделать» п.1).
 *
 * `prescription_ocr_pipeline_enabled`/`disputes_workflow_enabled` — `scope='global',
 * is_enabled=false` (гейт R2/R3-функциональности, выключен по умолчанию до готовности R2).
 *
 * Идемпотентность: явный `SELECT` перед `INSERT` — НЕ `ON CONFLICT (flag_key, scope, tenant_id)`:
 * `tenant_id IS NULL` для обоих (`scope='global'`), а Postgres `UNIQUE` не считает два `NULL`
 * равными (SQL-стандарт) — `ON CONFLICT` на этой паре молча вставил бы дубликат при повторном
 * запуске (тот же нюанс задокументирован в JSDoc `feature-flags-repository.port.ts`).
 *
 * Standalone CLI entrypoint (тот же приём, что `i18n-overrides-catalog.seed.ts`) — позволяет
 * пересеять ТОЛЬКО этот блок: `tsx src/db/seed/feature-flags.seed.ts`. Основной путь подключения
 * к рантайму — вызов из `seed-catalog.run.ts:main()` (см. правку там), выполняемый `pnpm db:seed`.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import { Pool } from 'pg'
import { featureFlags } from '@/db/schema/feature-flags.js'

interface RequiredFeatureFlagSeed {
  readonly flagKey: string
  readonly description: string
}

export const REQUIRED_R1_FEATURE_FLAGS: readonly RequiredFeatureFlagSeed[] = [
  {
    flagKey: 'prescription_ocr_pipeline_enabled',
    description: 'R2 — OCR-пайплайн распознавания рецептов (04-SCOPE-DECISION-PIVOT.md §4)',
  },
  {
    flagKey: 'disputes_workflow_enabled',
    description: 'R3 — полный workflow споров OrderDispute (D-EP11-6)',
  },
]

async function seedOneIfMissing(db: NodePgDatabase, flag: RequiredFeatureFlagSeed): Promise<boolean> {
  const existing = await db
    .select({ id: featureFlags.id })
    .from(featureFlags)
    .where(and(eq(featureFlags.flagKey, flag.flagKey), eq(featureFlags.scope, 'global')))
    .limit(1)
  if (existing.length > 0) {
    return false
  }
  await db.insert(featureFlags).values({ flagKey: flag.flagKey, scope: 'global', isEnabled: false, description: flag.description })
  return true
}

export async function seedRequiredFeatureFlags(db: NodePgDatabase): Promise<{ inserted: number }> {
  let inserted = 0
  for (const flag of REQUIRED_R1_FEATURE_FLAGS) {
    // eslint-disable-next-line no-await-in-loop -- 2 строки, seed-скрипт последователен по конвенции проекта (см. seed-catalog.run.ts insertCategories)
    if (await seedOneIfMissing(db, flag)) {
      inserted += 1
    }
  }
  return { inserted }
}

const DEFAULT_DB_CONNECT_TIMEOUT_MS = 5_000

async function main(): Promise<void> {
  if (process.env.DORUTJ_SEED_SKIP_MAIN === '1') return

  const dbUrl = process.env.DATABASE_URL
  if (dbUrl === undefined || dbUrl.length === 0) {
    // eslint-disable-next-line no-console -- CLI-скрипт, не часть Nest-приложения.
    console.error('DATABASE_URL is required for db:seed')
    process.exit(1)
  }

  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: DEFAULT_DB_CONNECT_TIMEOUT_MS })
  try {
    const db = drizzle(pool)
    const result = await seedRequiredFeatureFlags(db)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.log(`[db:seed:feature-flags] OK — inserted ${String(result.inserted)} required R1 feature flags`)
    process.exitCode = 0
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error(`[db:seed:feature-flags] FAILED: ${message}`)
    process.exitCode = 1
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const invokedDirectly =
  process.argv[1]?.endsWith('feature-flags.seed.ts') === true || process.argv[1]?.endsWith('feature-flags.seed') === true
if (invokedDirectly) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console -- CLI-скрипт.
    console.error('[db:seed:feature-flags] failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
