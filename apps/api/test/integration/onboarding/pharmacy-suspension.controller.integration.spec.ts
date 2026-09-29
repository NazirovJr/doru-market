import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { JwtClaims, JwtSignerPort } from '@/modules/auth/index.js'
import { cleanupTenant, connect, isPostgresReachable, seedChain, seedPharmacy, seedTenant, seedUser, TEST_DATABASE_URL } from '../returns/returns-test.fixture.js'
import { ORDERS_CANCELLATION_STUB_CALLS } from '../admin/__tests__/orders-cancellation-stub.module.js'
import { createSuspensionTestApp } from '../admin/__tests__/pharmacy-suspension-test-app.js'

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

interface ErrorBody {
  readonly error: { readonly code: string }
}

describe.skipIf(!postgresAvailable)('PharmacySuspensionController — HTTP integration', () => {
  let pool: Pool
  let db: NodePgDatabase
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let chainId: string
  let pharmacyId: string
  let adminId: string
  let adminTenantId: string

  beforeAll(async () => {
    ;({ pool, db } = connect())
    adminTenantId = await seedTenant(db)
    adminId = await seedUser(db, adminTenantId, 'super_admin')
    ;({ app, jwtSigner } = await createSuspensionTestApp())
    httpServer = app.getHttpServer() as Server
  }, 60_000)

  afterAll(async () => {
    await app.close()
    await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1', [adminId]).catch(() => undefined)
    await cleanupTenant(db, adminTenantId)
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId]).catch(() => undefined)
    ORDERS_CANCELLATION_STUB_CALLS.length = 0
  })

  function adminToken(): string {
    const claims: JwtClaims = {
      sub: adminId,
      role: 'super_admin',
      tenantId: null,
      pharmacyId: null,
      chainId: null,
      sessionId: randomUUID(),
    }
    return jwtSigner.sign(claims)
  }

  async function seedActivePharmacy(): Promise<void> {
    chainId = await seedChain(db)
    pharmacyId = await seedPharmacy(db, chainId)
    await pool.query(`UPDATE pharmacies SET status = 'active' WHERE id = $1`, [pharmacyId])
  }

  const url = (suffix: string): string => `/api/v1/admin/pharmacy-accounts/${pharmacyId}/${suffix}`

  it('force-cancel без Idempotency-Key -> 400 IDEMPOTENCY_KEY_REQUIRED, а не 500', async () => {
    await seedActivePharmacy()

    const response = await request(httpServer)
      .post(url('force-cancel-incomplete-orders'))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'fraud confirmed' })

    expect(response.status).toBe(400)
    expect((response.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  it('suspend: актор в журнале — пользователь из токена, для причины без force-cancel заказы без оплаты отменяются', async () => {
    await seedActivePharmacy()

    const response = await request(httpServer)
      .post(url('suspend'))
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ reason: 'voluntary_pause' })

    expect(response.status).toBe(201)
    const log = await pool.query<{ actor_user_id: string }>('SELECT actor_user_id FROM onboarding_review_log WHERE pharmacy_id = $1', [pharmacyId])
    expect(log.rows.map((r) => r.actor_user_id)).toEqual([adminId])
    expect(ORDERS_CANCELLATION_STUB_CALLS).toEqual([{ pharmacyId, scope: 'unpaid' }])
  })

  it('force-cancel с ключом: актор из токена; повтор с тем же ключом возвращает тот же ответ и не запускает отмену второй раз', async () => {
    await seedActivePharmacy()
    const token = adminToken()
    await request(httpServer).post(url('suspend')).set('Authorization', `Bearer ${token}`).send({ reason: 'fraud_or_safety' })
    ORDERS_CANCELLATION_STUB_CALLS.length = 0
    const key = randomUUID()
    const send = () =>
      request(httpServer)
        .post(url('force-cancel-incomplete-orders'))
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({ reason: 'fraud confirmed' })

    const first = await send()
    const second = await send()

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(ORDERS_CANCELLATION_STUB_CALLS).toEqual([{ pharmacyId, scope: 'all' }])
    const log = await pool.query<{ actor_user_id: string }>(
      `SELECT actor_user_id FROM onboarding_review_log WHERE pharmacy_id = $1 AND reason LIKE 'force_cancel%'`,
      [pharmacyId],
    )
    expect(log.rows.map((r) => r.actor_user_id)).toEqual([adminId])
  })
})
