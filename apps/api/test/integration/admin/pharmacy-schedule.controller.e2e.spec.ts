// Supertest integration PharmacyScheduleController против реальных Postgres/Redis (DTJ-367).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/pharmacy-schedule-test-app.js'

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
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string }
}
interface ScheduleBody {
  readonly id: string
  readonly isOpen247: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
}
interface DeliveryZoneBody {
  readonly id: string
  readonly maxDeliveryRadiusKm: number
}

const TEST_TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('PharmacyScheduleController — Supertest integration (DTJ-367)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let superAdminToken: string
  const createdPharmacyIds: string[] = []
  const createdChainIds: string[] = []
  const createdUserIds: string[] = []

  // audit_log.actor_user_id — FK на users(id): актор PATCH-запроса обязан существовать как строка.
  async function sign(role: string, extra?: Partial<JwtClaims>): Promise<string> {
    const userId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      userId,
      TEST_TENANT_ID,
      `+99290${userId.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
      role,
    ])
    createdUserIds.push(userId)
    return jwtSigner.sign({
      sub: userId,
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
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status) VALUES ($1, $2, $2, $3, 'active')`, [
      id,
      name,
      `tin-${id.slice(0, 8)}`,
    ])
    createdChainIds.push(id)
    return id
  }

  async function seedPharmacy(name: string, chainId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone, status, is_24_7, opening_time, closing_time, max_delivery_radius_km)
       VALUES ($1, $2, $3, 'Dushanbe, test str.', 38.5598, 68.7870, '+992900000001', 'active', false, '09:00', '18:00', 10.0)`,
      [id, chainId, name],
    )
    createdPharmacyIds.push(id)
    return id
  }

  function getSchedule(token: string, pharmacyId: string): request.Test {
    return request(httpServer).get(`/api/v1/pharmacy-accounts/${pharmacyId}/schedule`).set('Authorization', `Bearer ${token}`)
  }

  function patchSchedule(token: string, pharmacyId: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).patch(`/api/v1/pharmacy-accounts/${pharmacyId}/schedule`).set('Authorization', `Bearer ${token}`).send(body)
  }

  function patchDeliveryZone(token: string, pharmacyId: string, body: Record<string, unknown>): request.Test {
    return request(httpServer)
      .patch(`/api/v1/pharmacy-accounts/${pharmacyId}/delivery-zone`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    // audit_log.tenant_id — FK на tenants(id): актор пишет audit_log со своим tenantId.
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TEST_TENANT_ID,
      `dtj367-${TEST_TENANT_ID.slice(0, 8)}`,
    ])
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    superAdminToken = await sign('super_admin')
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
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = $1', [TEST_TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('GET возвращает засеянные значения для предзаполнения формы', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainId = await seedChain(`Schedule Chain Read ${suffix}`)
    const pharmacyId = await seedPharmacy(`Read pharmacy schedule ${suffix}`, chainId)
    const ownAdminToken = await sign('pharmacy_admin', { chainId })

    const res = await getSchedule(ownAdminToken, pharmacyId)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<ScheduleBody & { readonly maxDeliveryRadiusKm: number }>
    expect(body.data).toEqual({ id: pharmacyId, isOpen247: false, openingTime: '09:00', closingTime: '18:00', maxDeliveryRadiusKm: 10 })
  })

  it('AC1 — pharmacy_admin своей сети меняет расписание, PATCH сохраняет и читается обратно', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainId = await seedChain(`Schedule Chain Own ${suffix}`)
    const pharmacyId = await seedPharmacy(`Own pharmacy schedule ${suffix}`, chainId)
    const ownAdminToken = await sign('pharmacy_admin', { chainId })

    const res = await patchSchedule(ownAdminToken, pharmacyId, { isOpen247: true })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<ScheduleBody>
    expect(body.data).toEqual({ id: pharmacyId, isOpen247: true, openingTime: null, closingTime: null })

    const row = await pool.query<{ is_24_7: boolean; opening_time: string | null }>('SELECT is_24_7, opening_time FROM pharmacies WHERE id = $1', [
      pharmacyId,
    ])
    expect(row.rows[0]?.is_24_7).toBe(true)
    expect(row.rows[0]?.opening_time).toBeNull()
  })

  it('AC2 — maxDeliveryRadiusKm = -5 → 400 VALIDATION_ERROR', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainId = await seedChain(`Zone Chain Invalid ${suffix}`)
    const pharmacyId = await seedPharmacy(`Zone pharmacy invalid ${suffix}`, chainId)
    const ownAdminToken = await sign('pharmacy_admin', { chainId })

    const res = await patchDeliveryZone(ownAdminToken, pharmacyId, { maxDeliveryRadiusKm: -5 })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('AC3 — радиус сохраняется и читается обратно (основание для guard-а checkout, сам guard — EP-09)', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainId = await seedChain(`Zone Chain Save ${suffix}`)
    const pharmacyId = await seedPharmacy(`Zone pharmacy save ${suffix}`, chainId)
    const ownAdminToken = await sign('pharmacy_admin', { chainId })

    const res = await patchDeliveryZone(ownAdminToken, pharmacyId, { maxDeliveryRadiusKm: 5 })

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<DeliveryZoneBody>
    expect(body.data).toEqual({ id: pharmacyId, maxDeliveryRadiusKm: 5 })
    const row = await pool.query<{ max_delivery_radius_km: string }>('SELECT max_delivery_radius_km FROM pharmacies WHERE id = $1', [pharmacyId])
    expect(Number(row.rows[0]?.max_delivery_radius_km)).toBe(5)
  })

  it('AC4 — pharmacy_admin сети A меняет расписание аптеки сети B → 403 CROSS_TENANT_ACCESS_DENIED', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainAId = await seedChain(`Schedule Chain A ${suffix}`)
    const chainBId = await seedChain(`Schedule Chain B ${suffix}`)
    const foreignPharmacyId = await seedPharmacy(`Foreign pharmacy schedule ${suffix}`, chainBId)
    const ownAdminToken = await sign('pharmacy_admin', { chainId: chainAId })

    const res = await patchSchedule(ownAdminToken, foreignPharmacyId, { isOpen247: true })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('CROSS_TENANT_ACCESS_DENIED')
  })

  it('super_admin — меняет расписание любой аптеки без policy-проверки владения', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainId = await seedChain(`Schedule Chain Super ${suffix}`)
    const pharmacyId = await seedPharmacy(`Any pharmacy schedule ${suffix}`, chainId)

    const res = await patchSchedule(superAdminToken, pharmacyId, { isOpen247: false, openingTime: '10:00', closingTime: '20:00' })

    expect(res.status).toBe(200)
  })

  it('роль без доступа к маршруту (customer) → 403 INSUFFICIENT_ROLE', async () => {
    const suffix = randomUUID().slice(0, 8)
    const chainId = await seedChain(`Schedule Chain Customer ${suffix}`)
    const pharmacyId = await seedPharmacy(`Customer pharmacy schedule ${suffix}`, chainId)

    const res = await patchSchedule(await sign('customer'), pharmacyId, { isOpen247: true })

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })
})
