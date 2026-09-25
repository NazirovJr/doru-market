// Supertest integration UsersAdminController против реальных Postgres/Redis (DTJ-354).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/users-test-app.js'

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
interface UserDbRow {
  readonly deleted_at: string | null
  readonly role: string
}
interface AuditDbRow {
  readonly actor_user_id: string | null
  readonly metadata: Record<string, unknown>
}
interface UserSummaryBody {
  readonly id: string
  readonly tenantId: string
  readonly phoneNumber: string | null
  readonly role: string
  readonly fullName: string | null
  readonly isActive: boolean
  readonly createdAt: string
}

const OPERATOR_TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('UsersAdminController — Supertest integration (DTJ-354)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let superAdminId: string
  let superAdminToken: string
  const createdUserIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: string, tenantId: string = OPERATOR_TENANT_ID): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      id,
      tenantId,
      `+99290${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      role,
    ])
    createdUserIds.push(id)
    return id
  }

  function getUsers(token: string, qs = ''): request.Test {
    return request(httpServer).get(`/api/v1/users?limit=50${qs}`).set('Authorization', `Bearer ${token}`)
  }
  function patchDeactivate(token: string, id: string): request.Test {
    return request(httpServer)
      .patch(`/api/v1/users/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false })
  }
  function patchRole(token: string, id: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).patch(`/api/v1/users/${id}/role`).set('Authorization', `Bearer ${token}`).send(body)
  }
  function postGrant(token: string, id: string, body: Record<string, unknown>): request.Test {
    return request(httpServer)
      .post(`/api/v1/users/${id}/grant-platform-role`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      OPERATOR_TENANT_ID,
      `test-admin-354-op-${OPERATOR_TENANT_ID.slice(0, 8)}`,
    ])
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    superAdminId = await seedUser('super_admin')
    superAdminToken = sign({ sub: superAdminId, role: 'super_admin', tenantId: OPERATOR_TENANT_ID, pharmacyId: null, chainId: null })
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = $1', [OPERATOR_TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('super_admin GET /users видит кросс-тенантного пользователя (другой тенант)', async () => {
    const otherTenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      otherTenantId,
      `test-admin-354-other-${otherTenantId.slice(0, 8)}`,
    ])
    const otherUserId = await seedUser('pharmacist', otherTenantId)

    const res = await getUsers(superAdminToken)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly UserSummaryBody[]>
    expect(body.data.some((u) => u.id === otherUserId)).toBe(true)
    expect(body.meta?.pagination).toBeDefined()
    await pool.query('DELETE FROM tenants WHERE id = $1', [otherTenantId])
  })

  it('PATCH /users/:id {isActive:false} — деактивирует, GET отражает, строка НЕ удалена физически', async () => {
    const targetId = await seedUser('pharmacist')

    const res = await patchDeactivate(superAdminToken, targetId)

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<UserSummaryBody>).data.isActive).toBe(false)
    const row = await pool.query<UserDbRow>('SELECT id, deleted_at FROM users WHERE id = $1', [targetId])
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]?.deleted_at).toBeNull()
  })

  it('super_admin не может деактивировать сам себя → 403 FORBIDDEN', async () => {
    const res = await patchDeactivate(superAdminToken, superAdminId)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN')
  })

  it('АС1 — PATCH /users/:id/role {newRole:"super_admin"} → 400 VALIDATION_ERROR', async () => {
    const targetId = await seedUser('pharmacist')

    const res = await patchRole(superAdminToken, targetId, { newRole: 'super_admin' })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('PATCH /users/:id/role {newRole:"courier"} (бытовая роль) → 200, роль изменена в БД', async () => {
    const targetId = await seedUser('pharmacist')

    const res = await patchRole(superAdminToken, targetId, { newRole: 'courier' })

    expect(res.status).toBe(200)
    const row = await pool.query<UserDbRow>('SELECT role FROM users WHERE id = $1', [targetId])
    expect(row.rows[0]?.role).toBe('courier')
  })

  it('АС2 — POST /grant-platform-role без reason → 400 VALIDATION_ERROR, audit_log не создан', async () => {
    const targetId = await seedUser('pharmacist')

    const res = await postGrant(superAdminToken, targetId, { role: 'support_agent' })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    const audit = await pool.query(`SELECT id FROM audit_log WHERE entity_id = $1 AND category = 'role_grant'`, [targetId])
    expect(audit.rows).toHaveLength(0)
    const row = await pool.query<UserDbRow>('SELECT role FROM users WHERE id = $1', [targetId])
    expect(row.rows[0]?.role).toBe('pharmacist')
  })

  it('АС3 — успешный grant-platform-role: роль меняется И audit_log(category=role_grant) появляется', async () => {
    const targetId = await seedUser('pharmacist')

    const res = await postGrant(superAdminToken, targetId, { role: 'support_agent', reason: 'onboarding new support hire' })

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<UserSummaryBody>).data.role).toBe('support_agent')
    const row = await pool.query<UserDbRow>('SELECT role FROM users WHERE id = $1', [targetId])
    expect(row.rows[0]?.role).toBe('support_agent')
    const audit = await pool.query<AuditDbRow>(
      `SELECT category, entity_id, actor_user_id, reason, metadata FROM audit_log WHERE entity_id = $1 AND category = 'role_grant'`,
      [targetId],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.actor_user_id).toBe(superAdminId)
    expect(audit.rows[0]?.metadata).toMatchObject({ before: { role: 'pharmacist' }, after: { role: 'support_agent' } })
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE на GET /users и PATCH /users/:id', async () => {
    const targetId = await seedUser('pharmacist')
    const pharmacyAdminId = await seedUser('pharmacy_admin')
    const pharmacyAdminToken = sign({
      sub: pharmacyAdminId,
      role: 'pharmacy_admin',
      tenantId: OPERATOR_TENANT_ID,
      pharmacyId: null,
      chainId: null,
    })

    const listRes = await getUsers(pharmacyAdminToken)
    const patchRes = await patchDeactivate(pharmacyAdminToken, targetId)

    expect(listRes.status).toBe(403)
    expect((listRes.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    expect(patchRes.status).toBe(403)
    expect((patchRes.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('несуществующий пользователь → PATCH/POST возвращают 404 NOT_FOUND', async () => {
    const missingId = randomUUID()

    const deactivateRes = await patchDeactivate(superAdminToken, missingId)
    const roleRes = await patchRole(superAdminToken, missingId, { newRole: 'courier' })
    const grantRes = await postGrant(superAdminToken, missingId, { role: 'support_agent', reason: 'valid enough reason' })

    expect(deactivateRes.status).toBe(404)
    expect(roleRes.status).toBe(404)
    expect(grantRes.status).toBe(404)
  })
})
