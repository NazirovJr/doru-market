// E2E, реальный Postgres, без моков адаптера/пула. Своя БД dorutj_test_dtj377 (не общая
// dorutj_test — там REVOKE app_role сбит параллельными исполнителями, см. отчёт сдачи).
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY } from '@dorutj/contracts'
import { AuditLogRetentionJob } from './audit-log-retention.job.js'
import { PgAuditLogRetentionAdapter } from './pg-audit-log-retention.adapter.js'

const APP_ROLE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test_dtj377'
const SETUP_DATABASE_URL =
  process.env.AUDIT_RETENTION_SETUP_DATABASE_URL ??
  'postgres://dorutj_migrator:dorutj_dev_only_password@localhost:5432/dorutj_test_dtj377'
const RETENTION_ROLE_DATABASE_URL =
  process.env.AUDIT_RETENTION_TEST_DATABASE_URL ??
  'postgres://audit_retention_role:dorutj_dev_audit_retention_password@localhost:5432/dorutj_test_dtj377'
const PROBE_TIMEOUT_MS = 1_500
const RETENTION_YEARS = 5
const BATCH_SIZE = 1000

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

const postgresAvailable =
  (await isPostgresReachable(APP_ROLE_DATABASE_URL)) &&
  (await isPostgresReachable(SETUP_DATABASE_URL)) &&
  (await isPostgresReachable(RETENTION_ROLE_DATABASE_URL))

function yearsAgo(years: number): Date {
  const date = new Date()
  date.setFullYear(date.getFullYear() - years)
  return date
}

describe.skipIf(!postgresAvailable)('audit-log-retention — e2e (DTJ-377)', () => {
  describe('AC4: app_role по ошибке конфигурации', () => {
    let appRolePool: Pool

    beforeAll(() => {
      appRolePool = new Pool({ connectionString: APP_ROLE_DATABASE_URL })
    })

    afterAll(async () => {
      await appRolePool.end().catch(() => undefined)
    })

    it('DELETE через adapter, подключённый под app_role, отклоняется правами PostgreSQL', async () => {
      const misconfiguredAdapter = new PgAuditLogRetentionAdapter(appRolePool)

      await expect(
        misconfiguredAdapter.deleteBatch({
          cutoff: yearsAgo(RETENTION_YEARS),
          excludedCategory: AUDIT_LOG_RETENTION_EXCLUDED_CATEGORY,
          batchSize: BATCH_SIZE,
        }),
      ).rejects.toThrow(/permission denied/i)
    })
  })

  describe('полный проход джобы под audit_retention_role (боевая конфигурация прав)', () => {
    let setupPool: Pool
    let retentionPool: Pool
    let job: AuditLogRetentionJob
    const insertedIds: string[] = []

    beforeAll(() => {
      setupPool = new Pool({ connectionString: SETUP_DATABASE_URL })
      retentionPool = new Pool({ connectionString: RETENTION_ROLE_DATABASE_URL })
      const adapter = new PgAuditLogRetentionAdapter(retentionPool)
      job = new AuditLogRetentionJob(adapter, RETENTION_YEARS, BATCH_SIZE)
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

    it('АС1+АС2: смешанный набор — старая payment_override удалена, старая prescription_access и свежая payment_override остались', async () => {
      const oldOther = await seedRow('payment_override', yearsAgo(6))
      const oldPrescription = await seedRow('prescription_access', yearsAgo(10))
      const recentOther = await seedRow('payment_override', yearsAgo(1))

      await job.runOnce()

      expect(await rowExists(oldOther)).toBe(false)
      expect(await rowExists(oldPrescription)).toBe(true)
      expect(await rowExists(recentOther)).toBe(true)
    })
  })
})
