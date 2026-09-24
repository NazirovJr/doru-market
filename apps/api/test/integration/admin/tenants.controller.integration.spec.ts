/**
 * `TenantsController` — Supertest integration (EP-15, DTJ-351, тест-план тикета) против
 * РЕАЛЬНЫХ Postgres/Redis (`createTestApp()` — `tenants-test-app.ts`, своя копия harness'а,
 * см. её JSDoc).
 *
 * Покрывает критерии приёмки 1/2/3/4 тикета: `super_admin` видит ВСЕ тенанты (не только свой,
 * АС1); `codLimitDiram=-100` → `400 VALIDATION_ERROR` c `details.field='codLimitDiram'`, БД не
 * изменена (АС2); `PATCH` немедленно отражается в `GET /tenants/:id` (АС3); `pharmacy_admin` →
 * `403 INSUFFICIENT_ROLE` (АС4).
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/tenants-test-app.js'

const TEST_DATABASE_URL =
  process.env.ADMIN_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

interface SuccessBody<T> {
  readonly data: T
  readonly meta?: Record<string, unknown>
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface TenantSummaryBody {
  readonly id: string
  readonly slug: string
  readonly isNeutral: boolean
  readonly customDomain: string | null
  readonly brandName: string
  readonly createdAt: string
}
interface TenantDetailBody extends TenantSummaryBody {
  readonly brandLogoUrl: string | null
  readonly brandPalette: Readonly<Record<string, string>>
  readonly codLimitDiram: number
  readonly holdPeriodDays: number
}

const OPERATOR_TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('TenantsController — Supertest integration (DTJ-351)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let superAdminToken: string
  const createdUserIds: string[] = []
  const createdTenantIds: string[] = [OPERATOR_TENANT_ID]

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      id,
      OPERATOR_TENANT_ID,
      `+99290${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      role,
    ])
    createdUserIds.push(id)
    return id
  }

  /** Заводит РЕАЛЬНЫЙ управляемый тенант (с `tenant_settings`, обязательными для `tenantFromDb`). */
  async function seedManagedTenant(overrides: { codLimitDiram?: number; holdPeriodDays?: number } = {}): Promise<string> {
    const id = randomUUID()
    const slug = `test-tenant-351-${id.slice(0, 8)}`
    await pool.query(
      `INSERT INTO tenants (id, slug, is_neutral, courier_sourcing_mode, custom_domain_status) VALUES ($1, $2, false, 'platform_pool', 'none')`,
      [id, slug],
    )
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale, cod_limit_diram, hold_period_days)
       VALUES ($1, $2, '{}'::jsonb, 'tj', $3, $4)`,
      [id, `Test Brand ${id.slice(0, 8)}`, overrides.codLimitDiram ?? 50_000, overrides.holdPeriodDays ?? 1],
    )
    createdTenantIds.push(id)
    return id
  }

  function getTenants(token: string): request.Test {
    return request(httpServer).get('/api/v1/tenants?limit=50').set('Authorization', `Bearer ${token}`)
  }
  function getTenantById(token: string, id: string): request.Test {
    return request(httpServer).get(`/api/v1/tenants/${id}`).set('Authorization', `Bearer ${token}`)
  }
  function patchSettings(token: string, tenantId: string, body: Record<string, unknown>): request.Test {
    return request(httpServer)
      .patch(`/api/v1/tenant-settings/${tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      OPERATOR_TENANT_ID,
      `test-admin-351-op-${OPERATOR_TENANT_ID.slice(0, 8)}`,
    ])
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale) VALUES ($1, 'Operator', '{}'::jsonb, 'tj') ON CONFLICT (tenant_id) DO NOTHING`,
      [OPERATOR_TENANT_ID],
    )
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    const superAdminId = await seedUser('super_admin')
    superAdminToken = sign({ sub: superAdminId, role: 'super_admin', tenantId: OPERATOR_TENANT_ID, pharmacyId: null, chainId: null })
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM tenant_settings WHERE tenant_id = ANY($1)', [createdTenantIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [createdTenantIds])
      await pool.end().catch(() => undefined)
    }
  })

  it('АС1 — super_admin GET /tenants видит тенант, ОТЛИЧНЫЙ от своего собственного (кросс-тенантный список)', async () => {
    const managedId = await seedManagedTenant()

    const res = await getTenants(superAdminToken)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly TenantSummaryBody[]>
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.some((t) => t.id === managedId)).toBe(true)
    expect(body.meta?.pagination).toBeDefined()
  })

  it('АС2 — PATCH с codLimitDiram=-100 → 400 VALIDATION_ERROR (details.field=codLimitDiram), БД не изменена', async () => {
    const managedId = await seedManagedTenant({ codLimitDiram: 12_345 })

    const res = await patchSettings(superAdminToken, managedId, { codLimitDiram: -100 })

    expect(res.status).toBe(400)
    const body = res.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details?.field).toBe('codLimitDiram')

    const after = await getTenantById(superAdminToken, managedId)
    expect((after.body as SuccessBody<TenantDetailBody>).data.codLimitDiram).toBe(12_345)
  })

  it('АС3 — валидный PATCH brandName, GET /tenants/:id немедленно отражает новое значение', async () => {
    const managedId = await seedManagedTenant()
    const newBrandName = `Renamed ${randomUUID().slice(0, 8)}`

    const patched = await patchSettings(superAdminToken, managedId, { brandName: newBrandName })
    expect(patched.status).toBe(200)
    expect((patched.body as SuccessBody<TenantDetailBody>).data.brandName).toBe(newBrandName)

    const after = await getTenantById(superAdminToken, managedId)
    expect(after.status).toBe(200)
    expect((after.body as SuccessBody<TenantDetailBody>).data.brandName).toBe(newBrandName)
  })

  it('АС4 — pharmacy_admin → 403 INSUFFICIENT_ROLE на GET /tenants и PATCH /tenant-settings/:id', async () => {
    const managedId = await seedManagedTenant()
    const pharmacyAdminId = await seedUser('pharmacy_admin')
    const pharmacyAdminToken = sign({
      sub: pharmacyAdminId,
      role: 'pharmacy_admin',
      tenantId: OPERATOR_TENANT_ID,
      pharmacyId: null,
      chainId: null,
    })

    const listRes = await getTenants(pharmacyAdminToken)
    const patchRes = await patchSettings(pharmacyAdminToken, managedId, { brandName: 'hacked' })

    expect(listRes.status).toBe(403)
    expect((listRes.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    expect(patchRes.status).toBe(403)
    expect((patchRes.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('несуществующий тенант → GET/PATCH возвращают 404 NOT_FOUND', async () => {
    const missingId = randomUUID()

    const getRes = await getTenantById(superAdminToken, missingId)
    const patchRes = await patchSettings(superAdminToken, missingId, { brandName: 'x' })

    expect(getRes.status).toBe(404)
    expect((getRes.body as ErrorBody).error.code).toBe('NOT_FOUND')
    expect(patchRes.status).toBe(404)
    expect((patchRes.body as ErrorBody).error.code).toBe('NOT_FOUND')
  })

  it('невалидное тело PATCH (пустой объект {}) → 400 VALIDATION_ERROR', async () => {
    const managedId = await seedManagedTenant()

    const res = await patchSettings(superAdminToken, managedId, {})

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })
})
