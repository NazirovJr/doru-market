// Supertest integration PharmacyAccountsOverviewController против реальных Postgres/Redis (DTJ-353).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/pharmacy-accounts-test-app.js'

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
interface PharmacyAccountSummaryBody {
  readonly id: string
  readonly chainId: string | null
  readonly chainName: string | null
  readonly name: string
  readonly status: string
  readonly licenseExpiryDate: string | null
}

const TEST_TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('PharmacyAccountsOverviewController — Supertest integration (DTJ-353)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let superAdminToken: string
  let pharmacyAdminToken: string
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []

  function sign(role: string, extra?: Partial<JwtClaims>): string {
    return jwtSigner.sign({
      sub: randomUUID(),
      role: role as JwtClaims['role'],
      tenantId: TEST_TENANT_ID,
      pharmacyId: null,
      chainId: null,
      sessionId: randomUUID(),
      ...extra,
    })
  }

  async function seedChain(name: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status) VALUES ($1, $2, $2, $3, 'active')`,
      [id, name, `tin-${id.slice(0, 8)}`],
    )
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacy(name: string, status: string, chainId: string | null = null): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status)
       VALUES ($1, $2, $3, 'Dushanbe, test str.', 38.5598, 68.7870, '+992900000001', $4)`,
      [id, chainId, name, status],
    )
    createdPharmacyIds.push(id)
    return id
  }

  function getPharmacyAccounts(token: string, qs = ''): request.Test {
    return request(httpServer).get(`/api/v1/pharmacy-accounts?limit=50${qs}`).set('Authorization', `Bearer ${token}`)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    superAdminToken = sign('super_admin')
    pharmacyAdminToken = sign('pharmacy_admin')
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      if (createdPharmacyIds.length > 0) {
        await pool.query('DELETE FROM pharmacies WHERE id = ANY($1)', [createdPharmacyIds])
      }
      if (createdChainIds.length > 0) {
        await pool.query('DELETE FROM pharmacy_chains WHERE id = ANY($1)', [createdChainIds])
      }
      await pool.end().catch(() => undefined)
    }
  })

  it('АС1 — super_admin видит ВСЕ статусы одновременно, включая terminated (очередь EP-03 их не отдаёт)', async () => {
    const suffix = randomUUID().slice(0, 8)
    await seedPharmacy(`DTJ353 Draft ${suffix}`, 'draft')
    await seedPharmacy(`DTJ353 Pending ${suffix}`, 'pending_review')
    await seedPharmacy(`DTJ353 Active ${suffix}`, 'active')
    await seedPharmacy(`DTJ353 Suspended ${suffix}`, 'suspended')
    const terminatedId = await seedPharmacy(`DTJ353 Terminated ${suffix}`, 'terminated')

    const res = await getPharmacyAccounts(superAdminToken, `&filter[name][like]=${encodeURIComponent(suffix)}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly PharmacyAccountSummaryBody[]>
    expect(body.data).toHaveLength(5)
    expect(body.data.some((p) => p.id === terminatedId && p.status === 'terminated')).toBe(true)
    const statuses = new Set(body.data.map((p) => p.status))
    expect(statuses).toEqual(new Set(['draft', 'pending_review', 'active', 'suspended', 'terminated']))
  })

  it('АС2 — filter[name][like] кириллица, частичное совпадение, регистронезависимо', async () => {
    const suffix = randomUUID().slice(0, 8)
    const matchId = await seedPharmacy(`Аптека Салом №1 ${suffix}`, 'active')
    const otherId = await seedPharmacy(`Другая аптека ${suffix}`, 'active')

    const res = await getPharmacyAccounts(superAdminToken, `&filter[name][like]=${encodeURIComponent('салом')}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly PharmacyAccountSummaryBody[]>
    expect(body.data.some((p) => p.id === matchId)).toBe(true)
    expect(body.data.some((p) => p.id === otherId)).toBe(false)
  })

  it('filter[chainId] — возвращает только аптеки указанной сети, chainName резолвится', async () => {
    const chainId = await seedChain(`Salom Network ${randomUUID().slice(0, 8)}`)
    const inChainId = await seedPharmacy(`Chain pharmacy ${randomUUID().slice(0, 8)}`, 'active', chainId)
    const outsideChainId = await seedPharmacy(`Other pharmacy ${randomUUID().slice(0, 8)}`, 'active', null)

    const res = await getPharmacyAccounts(superAdminToken, `&filter[chainId]=${chainId}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly PharmacyAccountSummaryBody[]>
    expect(body.data.some((p) => p.id === outsideChainId)).toBe(false)
    const found = body.data.find((p) => p.id === inChainId)
    expect(found?.chainId).toBe(chainId)
    expect(found?.chainName).not.toBeNull()
  })

  it('АС3 — pharmacy_admin без scope=own → 403 CROSS_TENANT_ACCESS_DENIED (не INSUFFICIENT_ROLE)', async () => {
    const res = await getPharmacyAccounts(pharmacyAdminToken)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('роль без доступа к маршруту вовсе (customer) → 403 INSUFFICIENT_ROLE (RolesGuard, до application-policy)', async () => {
    const res = await getPharmacyAccounts(sign('customer'))

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  // scope=own: pharmacy_admin видит только точки СВОЕЙ сети, chainId резолвится из JWT.
  it('pharmacy_admin сети A видит ТОЛЬКО точки сети A, даже если в query передан chainId сети B', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainAId = await seedChain(`Own Chain A ${suffix}`)
    const chainBId = await seedChain(`Own Chain B ${suffix}`)
    const ownPharmacyId = await seedPharmacy(`Own pharmacy A ${suffix}`, 'active', chainAId)
    const foreignPharmacyId = await seedPharmacy(`Foreign pharmacy B ${suffix}`, 'active', chainBId)
    const ownAdminToken = sign('pharmacy_admin', { chainId: chainAId })

    const res = await getPharmacyAccounts(ownAdminToken, `&scope=own&filter[chainId]=${chainBId}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly PharmacyAccountSummaryBody[]>
    expect(body.data.some((p) => p.id === ownPharmacyId)).toBe(true)
    expect(body.data.some((p) => p.id === foreignPharmacyId)).toBe(false)
    expect(body.data.every((p) => p.chainId === chainAId)).toBe(true)
  })

  it('DTJ-362 — pharmacy_admin сети A вызывает scope=own без query[chainId] — тот же результат (own точки сети A)', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainId = await seedChain(`Own Chain Solo ${suffix}`)
    const ownPharmacyId = await seedPharmacy(`Own pharmacy solo ${suffix}`, 'active', chainId)
    const ownAdminToken = sign('pharmacy_admin', { chainId })

    const res = await getPharmacyAccounts(ownAdminToken, '&scope=own')

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly PharmacyAccountSummaryBody[]>
    expect(body.data.some((p) => p.id === ownPharmacyId)).toBe(true)
  })

  it('DTJ-362 — pharmacy_admin без chainId в токене (некорректный актор) → 403 CROSS_TENANT_ACCESS_DENIED, до обращения к БД', async () => {
    const res = await getPharmacyAccounts(sign('pharmacy_admin', { chainId: null }), '&scope=own')

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('DTJ-362 — super_admin со scope=own → 403 CROSS_TENANT_ACCESS_DENIED (own предназначен только pharmacy_admin)', async () => {
    const res = await getPharmacyAccounts(superAdminToken, '&scope=own')

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })
})
