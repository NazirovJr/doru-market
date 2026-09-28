// Интеграционный тест DrizzleCommissionRateRepository.resolveActiveRate (DTJ-358) — реальный Postgres, специфичность D-03/SRS-DOM-160 + окно действия effectiveFrom/effectiveTo.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleCommissionRateRepository } from '@/modules/payments/infrastructure/repositories/commission-rate.repository.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500

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

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

const DAY_MS = 86_400_000
function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}
function daysFromNow(days: number): string {
  return dateOnly(new Date(Date.now() + days * DAY_MS))
}

interface RateFixture {
  readonly tenantId: string
  readonly chainId: string | null
  readonly category: string | null
  readonly rateBps: number
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

describe.skipIf(!postgresAvailable)('DrizzleCommissionRateRepository.resolveActiveRate — integration (DTJ-358)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repo: DrizzleCommissionRateRepository
  let tenantId: string
  let otherTenantId: string
  let chainId: string
  let userId: string
  let insertedRateIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    repo = new DrizzleCommissionRateRepository(db)

    tenantId = randomUUID()
    otherTenantId = randomUUID()
    chainId = randomUUID()
    userId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj358-${tenantId.slice(0, 8)}`])
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [otherTenantId, `dtj358-${otherTenantId.slice(0, 8)}`])
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'DTJ-358 Test Chain', 'DTJ-358 Test Chain LLC', $2)`, [
      chainId,
      chainId.replace(/-/g, '').slice(0, 20),
    ])
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'super_admin')`, [userId, tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantId, otherTenantId]]).catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    if (insertedRateIds.length > 0) {
      await pool.query('DELETE FROM platform_fee WHERE id = ANY($1)', [insertedRateIds])
      insertedRateIds = []
    }
  })

  async function insertRate(fixture: RateFixture): Promise<void> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO platform_fee (id, tenant_id, chain_id, commission_category, commission_bps, effective_from, effective_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, fixture.tenantId, fixture.chainId, fixture.category, fixture.rateBps, fixture.effectiveFrom, fixture.effectiveTo, userId],
    )
    insertedRateIds.push(id)
  }

  it('нет ни одной строки platform_fee для тенанта → null (вызывающий применяет покатегорийный дефолт)', async () => {
    const rate = await repo.resolveActiveRate({ tenantId, chainId: null, category: 'rx', now: new Date() })
    expect(rate).toBeNull()
  })

  it('тенант-дефолт (chain=null, category=null) — самый общий уровень специфичности', async () => {
    await insertRate({ tenantId, chainId: null, category: null, rateBps: 700, effectiveFrom: daysFromNow(-1), effectiveTo: null })
    const rate = await repo.resolveActiveRate({ tenantId, chainId: null, category: 'rx', now: new Date() })
    expect(rate).toBe(700)
  })

  it('(tenant,category) побеждает (tenant,null) для СВОЕЙ категории, но не для другой', async () => {
    await insertRate({ tenantId, chainId: null, category: null, rateBps: 700, effectiveFrom: daysFromNow(-1), effectiveTo: null })
    await insertRate({ tenantId, chainId: null, category: 'rx', rateBps: 900, effectiveFrom: daysFromNow(-1), effectiveTo: null })

    await expect(repo.resolveActiveRate({ tenantId, chainId: null, category: 'rx', now: new Date() })).resolves.toBe(900)
    await expect(repo.resolveActiveRate({ tenantId, chainId: null, category: 'otc', now: new Date() })).resolves.toBe(700)
  })

  it('(tenant,chain,category) побеждает (tenant,category) — только когда запрос несёт chainId', async () => {
    await insertRate({ tenantId, chainId: null, category: 'rx', rateBps: 900, effectiveFrom: daysFromNow(-1), effectiveTo: null })
    await insertRate({ tenantId, chainId, category: 'rx', rateBps: 650, effectiveFrom: daysFromNow(-1), effectiveTo: null })

    await expect(repo.resolveActiveRate({ tenantId, chainId, category: 'rx', now: new Date() })).resolves.toBe(650)
    await expect(repo.resolveActiveRate({ tenantId, chainId: null, category: 'rx', now: new Date() })).resolves.toBe(900)
  })

  it('АС3 — будущая ставка (effectiveFrom завтра) НЕ применяется сегодня', async () => {
    await insertRate({ tenantId, chainId: null, category: 'rx', rateBps: 999, effectiveFrom: daysFromNow(1), effectiveTo: null })
    const rate = await repo.resolveActiveRate({ tenantId, chainId: null, category: 'rx', now: new Date() })
    expect(rate).toBeNull()
  })

  it('истёкшая ставка (effectiveTo вчера) игнорируется, актуальная — применяется', async () => {
    await insertRate({ tenantId, chainId: null, category: 'rx', rateBps: 111, effectiveFrom: daysFromNow(-30), effectiveTo: daysFromNow(-1) })
    await insertRate({ tenantId, chainId: null, category: 'rx', rateBps: 222, effectiveFrom: daysFromNow(-1), effectiveTo: null })
    const rate = await repo.resolveActiveRate({ tenantId, chainId: null, category: 'rx', now: new Date() })
    expect(rate).toBe(222)
  })

  it('тенант-изоляция — ставка другого тенанта не резолвится', async () => {
    await insertRate({ tenantId: otherTenantId, chainId: null, category: 'rx', rateBps: 555, effectiveFrom: daysFromNow(-1), effectiveTo: null })
    const rate = await repo.resolveActiveRate({ tenantId, chainId: null, category: 'rx', now: new Date() })
    expect(rate).toBeNull()
  })
})
