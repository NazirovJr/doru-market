// Два пула: setupPool (dorutj_migrator, INSERT/DELETE для фикстур — audit_retention_role
// умеет только SELECT/DELETE) и retentionPool (audit_retention_role — то, под чем реально
// работает адаптер, боевая конфигурация прав, не суперправа мигратора).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PgAuditLogRetentionAdapter } from './pg-audit-log-retention.adapter.js'

const SETUP_DATABASE_URL =
  process.env.AUDIT_RETENTION_SETUP_DATABASE_URL ??
  'postgres://dorutj_migrator:dorutj_dev_only_password@localhost:5432/dorutj_test_dtj377'
const RETENTION_ROLE_DATABASE_URL =
  process.env.AUDIT_RETENTION_TEST_DATABASE_URL ??
  'postgres://audit_retention_role:dorutj_dev_audit_retention_password@localhost:5432/dorutj_test_dtj377'
const PROBE_TIMEOUT_MS = 1_500
const EXCLUDED_CATEGORY = 'prescription_access'
const OTHER_CATEGORY = 'payment_override'

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const postgresAvailable = (await isPostgresReachable(SETUP_DATABASE_URL)) && (await isPostgresReachable(RETENTION_ROLE_DATABASE_URL))

function yearsAgo(years: number): Date {
  const date = new Date()
  date.setFullYear(date.getFullYear() - years)
  return date
}

describe.skipIf(!postgresAvailable)('PgAuditLogRetentionAdapter — integration (DTJ-377)', () => {
  let setupPool: Pool
  let retentionPool: Pool
  let adapter: PgAuditLogRetentionAdapter
  const insertedIds: string[] = []

  beforeAll(() => {
    setupPool = new Pool({ connectionString: SETUP_DATABASE_URL })
    retentionPool = new Pool({ connectionString: RETENTION_ROLE_DATABASE_URL })
    adapter = new PgAuditLogRetentionAdapter(retentionPool)
  })

  afterAll(async () => {
    await Promise.all([setupPool.end().catch(() => undefined), retentionPool.end().catch(() => undefined)])
  })

  afterEach(async () => {
    for (const id of insertedIds.splice(0)) {
      await setupPool.query('DELETE FROM audit_log WHERE id = $1', [id]).catch(() => undefined)
    }
  })

  async function seedRow(category: string, createdAt: Date): Promise<string> {
    const id = randomUUID()
    await setupPool.query(
      `INSERT INTO audit_log (id, category, entity_type, entity_id, action, metadata, created_at)
       VALUES ($1, $2, 'order', $3, 'test_action', '{}'::jsonb, $4)`,
      [id, category, randomUUID(), createdAt],
    )
    insertedIds.push(id)
    return id
  }

  async function rowExists(id: string): Promise<boolean> {
    const result = await setupPool.query('SELECT 1 FROM audit_log WHERE id = $1', [id])
    return (result.rowCount ?? 0) > 0
  }

  it('АС1: запись старше cutoff, категория НЕ исключённая — удалена', async () => {
    const oldId = await seedRow(OTHER_CATEGORY, yearsAgo(6))
    const cutoff = yearsAgo(5)

    const deleted = await adapter.deleteBatch({ cutoff, excludedCategory: EXCLUDED_CATEGORY, batchSize: 1000 })

    expect(deleted).toBeGreaterThanOrEqual(1)
    expect(await rowExists(oldId)).toBe(false)
  })

  it('запись МОЛОЖЕ cutoff — НЕ удалена', async () => {
    const recentId = await seedRow(OTHER_CATEGORY, yearsAgo(1))
    const cutoff = yearsAgo(5)

    await adapter.deleteBatch({ cutoff, excludedCategory: EXCLUDED_CATEGORY, batchSize: 1000 })

    expect(await rowExists(recentId)).toBe(true)
  })

  it('АС2: prescription_access старше cutoff (даже 10 лет) — НИКОГДА не удалена', async () => {
    const prescriptionId = await seedRow(EXCLUDED_CATEGORY, yearsAgo(10))
    const cutoff = yearsAgo(5)

    await adapter.deleteBatch({ cutoff, excludedCategory: EXCLUDED_CATEGORY, batchSize: 1000 })

    expect(await rowExists(prescriptionId)).toBe(true)
  })

  it('АС3: batchSize ограничивает число строк, удаляемых ЗА ОДИН вызов', async () => {
    const cutoff = yearsAgo(5)
    await Promise.all(Array.from({ length: 3 }, () => seedRow(OTHER_CATEGORY, yearsAgo(6))))

    const deletedFirstBatch = await adapter.deleteBatch({ cutoff, excludedCategory: EXCLUDED_CATEGORY, batchSize: 2 })

    expect(deletedFirstBatch).toBe(2)
  })

  it('идемпотентность: второй deleteBatch над УЖЕ удалённой строкой не находит её повторно', async () => {
    const cutoff = yearsAgo(5)
    const id = await seedRow(OTHER_CATEGORY, yearsAgo(6))
    await adapter.deleteBatch({ cutoff, excludedCategory: EXCLUDED_CATEGORY, batchSize: 1 })
    expect(await rowExists(id)).toBe(false)

    await expect(adapter.deleteBatch({ cutoff, excludedCategory: EXCLUDED_CATEGORY, batchSize: 1 })).resolves.toEqual(
      expect.any(Number),
    )
  })
})
