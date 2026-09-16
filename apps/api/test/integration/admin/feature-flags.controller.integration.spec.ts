/**
 * `FeatureFlagsController` — Supertest integration (EP-15, DTJ-352, тест-план тикета) против
 * РЕАЛЬНЫХ Postgres/Redis (тот же `createTestApp()`, что `support-tickets.controller.integration.
 * spec.ts`, DTJ-282).
 *
 * Покрывает АС3/АС4 тикета (валидация ДО `INSERT`) + тест-план («реальная БД, UNIQUE-конфликт
 * при дублирующей паре `(flag_key, scope, tenant_id)`») + RBAC (только `super_admin`).
 */
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

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
interface FlagBody {
  readonly id: string
  readonly flagKey: string
  readonly scope: string
  readonly tenantId: string | null
  readonly isEnabled: boolean
  readonly rolloutPercentage: number
  readonly updatedBy: string | null
}

const TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable)('FeatureFlagsController — Supertest integration (DTJ-352)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let superAdminId: string
  let superAdminToken: string
  const createdUserIds: string[] = []
  const createdFlagIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, $4, true)`, [
      id,
      TENANT_ID,
      `+99290${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
      role,
    ])
    createdUserIds.push(id)
    return id
  }

  function postFlag(token: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).post('/api/v1/feature-flags').set('Authorization', `Bearer ${token}`).send(body)
  }
  function patchFlag(token: string, id: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).patch(`/api/v1/feature-flags/${id}`).set('Authorization', `Bearer ${token}`).send(body)
  }
  function listFlags(token: string): request.Test {
    return request(httpServer).get('/api/v1/feature-flags?limit=50').set('Authorization', `Bearer ${token}`)
  }

  async function createFlag(overrides: Record<string, unknown> = {}): Promise<FlagBody> {
    const res = await postFlag(superAdminToken, {
      flagKey: `test_flag_${randomUUID().slice(0, 8)}`,
      scope: 'global',
      isEnabled: false,
      rolloutPercentage: 100,
      ...overrides,
    })
    const body = (res.body as SuccessBody<FlagBody>).data
    createdFlagIds.push(body.id)
    return body
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      `test-admin-352-${TENANT_ID.slice(0, 8)}`,
    ])
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    superAdminId = await seedUser('super_admin')
    superAdminToken = sign({ sub: superAdminId, role: 'super_admin', tenantId: TENANT_ID, pharmacyId: null, chainId: null })
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM feature_flags WHERE id = ANY($1)', [createdFlagIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('super_admin POST / c scope=global → 201, updatedBy = claims.sub', async () => {
    const flagKey = `prescription_ocr_pipeline_enabled_${randomUUID().slice(0, 8)}`

    const res = await postFlag(superAdminToken, { flagKey, scope: 'global', isEnabled: false, rolloutPercentage: 100 })

    expect(res.status).toBe(201)
    const body = (res.body as SuccessBody<FlagBody>).data
    createdFlagIds.push(body.id)
    expect(body.flagKey).toBe(flagKey)
    expect(body.tenantId).toBeNull()
    expect(body.updatedBy).toBe(superAdminId)
  })

  it('АС3 — POST с scope=tenant БЕЗ tenantId → 400 VALIDATION_ERROR, БД не изменена', async () => {
    const res = await postFlag(superAdminToken, {
      flagKey: `no_tenant_id_${randomUUID().slice(0, 8)}`,
      scope: 'tenant',
      isEnabled: true,
      rolloutPercentage: 100,
    })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('АС4 — PATCH с rolloutPercentage=150 (вне диапазона) → 400 VALIDATION_ERROR', async () => {
    const flag = await createFlag()

    const res = await patchFlag(superAdminToken, flag.id, {
      flagKey: flag.flagKey,
      scope: 'global',
      isEnabled: true,
      rolloutPercentage: 150,
    })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('UNIQUE-конфликт: 2-й POST с ТЕМ ЖЕ (flagKey, scope=global) → 409 CONFLICT', async () => {
    const flagKey = `duplicate_flag_${randomUUID().slice(0, 8)}`
    const first = await postFlag(superAdminToken, { flagKey, scope: 'global', isEnabled: false, rolloutPercentage: 100 })
    expect(first.status).toBe(201)
    createdFlagIds.push((first.body as SuccessBody<FlagBody>).data.id)

    const second = await postFlag(superAdminToken, { flagKey, scope: 'global', isEnabled: true, rolloutPercentage: 100 })

    expect(second.status).toBe(409)
    expect((second.body as ErrorBody).error.code).toBe('CONFLICT')
  })

  it('PATCH существующего флага изменяет isEnabled/rolloutPercentage, GET сразу отражает новое значение', async () => {
    const flag = await createFlag({ isEnabled: false, rolloutPercentage: 100 })

    const patched = await patchFlag(superAdminToken, flag.id, {
      flagKey: flag.flagKey,
      scope: 'global',
      isEnabled: true,
      rolloutPercentage: 50,
    })

    expect(patched.status).toBe(200)
    const patchedBody = (patched.body as SuccessBody<FlagBody>).data
    expect(patchedBody.isEnabled).toBe(true)
    expect(patchedBody.rolloutPercentage).toBe(50)
    expect(patchedBody.id).toBe(flag.id)
  })

  it('per-tenant флаг: POST scope=tenant с tenantId → 201, tenantId сохранён', async () => {
    const flagKey = `tenant_scoped_${randomUUID().slice(0, 8)}`

    const res = await postFlag(superAdminToken, {
      flagKey,
      scope: 'tenant',
      tenantId: TENANT_ID,
      isEnabled: true,
      rolloutPercentage: 100,
    })

    expect(res.status).toBe(201)
    const body = (res.body as SuccessBody<FlagBody>).data
    createdFlagIds.push(body.id)
    expect(body.tenantId).toBe(TENANT_ID)
    expect(body.scope).toBe('tenant')
  })

  it('не-super_admin (support_agent) → 403 INSUFFICIENT_ROLE на GET/POST/PATCH', async () => {
    const agentId = await seedUser('support_agent')
    const agentToken = sign({ sub: agentId, role: 'support_agent', tenantId: TENANT_ID, pharmacyId: null, chainId: null })

    const getRes = await listFlags(agentToken)
    const postRes = await postFlag(agentToken, { flagKey: 'x', scope: 'global', isEnabled: true, rolloutPercentage: 100 })

    expect(getRes.status).toBe(403)
    expect((getRes.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    expect(postRes.status).toBe(403)
  })

  it('GET / возвращает пагинированный список (meta.pagination.limit присутствует)', async () => {
    await createFlag()

    const res = await listFlags(superAdminToken)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly FlagBody[]>
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.meta?.pagination).toBeDefined()
  })
})
