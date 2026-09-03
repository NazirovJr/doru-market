/**
 * Интеграционный тест `TenancyFacadeAdapter` (EP-09, DTJ-228/229) — РЕАЛЬНЫЙ Postgres. Фокус:
 * `getCodLimitDiram` читает РЕАЛЬНОЕ значение `tenant_settings.cod_limit_diram`, с fallback на
 * `COD_LIMIT_DEFAULT_DIRAM`, если строка `tenant_settings` отсутствует (тенант без настроек —
 * структурная защита, не должна происходить в проде, но не должна и падать).
 * `resolveCommissionRate` — ПОКАТЕГОРИЙНЫЙ дефолт SRS-DOM-160 (правка по решению CTO, спор №1) —
 * `rx`/`otc`/`parapharma` дают РАЗНЫЕ ставки (быстрый чистый unit-набор на ту же логику —
 * `tenancy-facade.adapter.spec.ts`, без живого Postgres; здесь — сквозная проверка через
 * реально сконструированный адаптер). `getEnabledPaymentMethods` — R1-константа (ASSUMPTION,
 * см. JSDoc адаптера) — проверяется как контракт, не как «настоящее чтение из БД».
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { DrizzleTenantSettingsRepository } from '@/modules/tenancy/infrastructure/repositories/tenant-settings.repository.js'
import { TenancyFacadeAdapter } from '@/modules/orders/infrastructure/adapters/tenancy-facade.adapter.js'
import { COD_LIMIT_DEFAULT_DIRAM } from '@/modules/orders/domain/order-create-command.js'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

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

describe.skipIf(!postgresAvailable)('TenancyFacadeAdapter — integration (DTJ-228/229)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let adapter: TenancyFacadeAdapter
  let tenantId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    adapter = new TenancyFacadeAdapter(new DrizzleTenantSettingsRepository(db))
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
  })

  async function seedTenant(): Promise<void> {
    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj228-${tenantId.slice(0, 8)}`])
  }

  it('getCodLimitDiram — читает РЕАЛЬНОЕ значение tenant_settings.cod_limit_diram', async () => {
    await seedTenant()
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, cod_limit_diram) VALUES ($1, 'Test Brand', 75000)`,
      [tenantId],
    )

    const limit = await adapter.getCodLimitDiram(tenantId)
    expect(limit).toBe(75_000n)
  })

  it('getCodLimitDiram — tenant_settings отсутствует → fallback COD_LIMIT_DEFAULT_DIRAM (не бросает)', async () => {
    await seedTenant() // БЕЗ строки tenant_settings
    const limit = await adapter.getCodLimitDiram(tenantId)
    expect(limit).toBe(COD_LIMIT_DEFAULT_DIRAM)
  })

  it('resolveCommissionRate — SRS-DOM-160: rx=500, otc=800, parapharma=1200 bps, ставки РАЗЛИЧАЮТСЯ', async () => {
    await seedTenant()
    const rx = await adapter.resolveCommissionRate(tenantId, null, 'rx')
    const otc = await adapter.resolveCommissionRate(tenantId, null, 'otc')
    const parapharma = await adapter.resolveCommissionRate(tenantId, null, 'parapharma')

    expect(rx).toBe(500)
    expect(otc).toBe(800)
    expect(parapharma).toBe(1_200)
    expect(new Set([rx, otc, parapharma]).size).toBe(3) // все три различны
  })

  it('resolveCommissionRate — не зависит от chainId (специфичность (tenant,chain,category) недоступна, TODO(EP-10))', async () => {
    await seedTenant()
    const withoutChain = await adapter.resolveCommissionRate(tenantId, null, 'otc')
    const withChain = await adapter.resolveCommissionRate(tenantId, 'some-chain', 'otc')
    expect(withChain).toBe(withoutChain)
  })

  it('getEnabledPaymentMethods — R1-дефолт содержит cash_courier (ASSUMPTION документа)', async () => {
    await seedTenant()
    const methods = await adapter.getEnabledPaymentMethods(tenantId)
    expect(methods).toContain('cash_courier')
  })
})
