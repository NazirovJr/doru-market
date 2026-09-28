// Supertest integration против реального Postgres/Redis (бутстрап AuthModule).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PLATFORM_SETTINGS_KEY_NAMES } from '@dorutj/contracts'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/platform-settings-test-app.js'

const TEST_DATABASE_URL =
  process.env.ADMIN_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
// Задано ПРЯМО (не `??=`) — отличается от дефолта схемы, проверяет чтение актуального ENV.
const DISTINCTIVE_RATE_LIMIT_VALUE = '777'
process.env.RATE_LIMIT_ANON_PER_MIN = DISTINCTIVE_RATE_LIMIT_VALUE

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
interface PlatformSettingBody {
  readonly key: string
  readonly currentValue: string
  readonly descriptionKey: string
  readonly requiresRedeploy: boolean
}

describe.skipIf(!postgresAvailable)('PlatformSettingsController — Supertest integration (DTJ-360)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let superAdminToken: string
  let pharmacyAdminToken: string

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  beforeAll(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    superAdminToken = sign({ sub: randomUUID(), role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })
    pharmacyAdminToken = sign({ sub: randomUUID(), role: 'pharmacy_admin', tenantId: randomUUID(), pharmacyId: null, chainId: null })
  })

  afterAll(async () => {
    await ctx.close()
  })

  it('АС1 — GET /platform-settings → 200, RATE_LIMIT_ANON_PER_MIN совпадает с реальным ENV процесса', async () => {
    const res = await request(httpServer).get('/api/v1/platform-settings').set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly PlatformSettingBody[]>
    const entry = body.data.find((item) => item.key === 'RATE_LIMIT_ANON_PER_MIN')
    expect(entry?.currentValue).toBe(DISTINCTIVE_RATE_LIMIT_VALUE)
  })

  it('АС2 — КАЖДАЯ строка помечена requiresRedeploy: true, полный список PLATFORM_SETTINGS_KEYS без пропусков', async () => {
    const res = await request(httpServer).get('/api/v1/platform-settings').set('Authorization', `Bearer ${superAdminToken}`)

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly PlatformSettingBody[]>
    expect(body.data).toHaveLength(PLATFORM_SETTINGS_KEY_NAMES.length)
    expect(body.data.every((entry) => entry.requiresRedeploy)).toBe(true)
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE', async () => {
    const res = await request(httpServer).get('/api/v1/platform-settings').set('Authorization', `Bearer ${pharmacyAdminToken}`)

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('без Authorization → 401', async () => {
    const res = await request(httpServer).get('/api/v1/platform-settings')

    expect(res.status).toBe(401)
  })

  it('АС3 — PATCH/POST/DELETE на /platform-settings физически не зарегистрированы → 404 (даже для super_admin)', async () => {
    const results = await Promise.all([
      request(httpServer).patch('/api/v1/platform-settings').set('Authorization', `Bearer ${superAdminToken}`),
      request(httpServer).post('/api/v1/platform-settings').set('Authorization', `Bearer ${superAdminToken}`),
      request(httpServer).delete('/api/v1/platform-settings').set('Authorization', `Bearer ${superAdminToken}`),
    ])

    for (const res of results) {
      expect(res.status).toBe(404)
    }
  })
})
