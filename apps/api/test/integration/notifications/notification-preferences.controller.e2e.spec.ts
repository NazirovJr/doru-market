// Supertest integration NotificationPreferencesController против реальных Postgres/Redis (DTJ-371, SRS-ADM-058).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import IORedis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { createTestApp, type TestApp } from './__tests__/preferences-test-app.js'

const TEST_DATABASE_URL =
  process.env.NOTIFICATIONS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const TEST_REDIS_URL = process.env.NOTIFICATIONS_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6380/0'
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

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new IORedis(url, { lazyConnect: true, connectTimeout: PROBE_TIMEOUT_MS, maxRetriesPerRequest: 0, retryStrategy: () => null })
  client.on('error', () => undefined)
  try {
    await client.connect()
    await client.ping()
    return true
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

const [postgresAvailable, redisAvailable] = await Promise.all([isPostgresReachable(TEST_DATABASE_URL), isRedisReachable(TEST_REDIS_URL)])

interface SuccessBody<T> {
  readonly data: T
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface PreferenceBody {
  readonly category: string
  readonly channel: string
  readonly isEnabled: boolean
  readonly quietHoursStart: string | null
  readonly quietHoursEnd: string | null
  readonly updatedAt: string
}

const TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable || !redisAvailable)('NotificationPreferencesController — Supertest integration (DTJ-371)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const createdUserIds: string[] = []

  function sign(sub: string): string {
    return jwtSigner.sign({ sub, role: 'customer', tenantId: TENANT_ID, pharmacyId: null, chainId: null, sessionId: randomUUID() })
  }

  async function seedUser(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, phone_number, role, is_active) VALUES ($1, $2, $3, 'customer', true)`, [
      id,
      TENANT_ID,
      `+99290${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`,
    ])
    createdUserIds.push(id)
    return id
  }

  function getPreferences(token: string): request.Test {
    return request(httpServer).get('/api/v1/notification-preferences').set('Authorization', `Bearer ${token}`)
  }
  function patchPreferences(token: string, body: Record<string, unknown>): request.Test {
    return request(httpServer).patch('/api/v1/notification-preferences').set('Authorization', `Bearer ${token}`).send(body)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      `test-dtj371-${TENANT_ID.slice(0, 8)}`,
    ])
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale) VALUES ($1, 'DTJ-371 e2e', '{}'::jsonb, 'tj') ON CONFLICT (tenant_id) DO NOTHING`,
      [TENANT_ID],
    )
    ctx = await createTestApp(TEST_DATABASE_URL, TEST_REDIS_URL)
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM notification_preferences WHERE user_id = ANY($1)', [createdUserIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [TENANT_ID])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('свежий пользователь — GET возвращает пустой список (переопределений ещё нет)', async () => {
    const userId = await seedUser()
    const token = sign(userId)

    const res = await getPreferences(token)

    expect(res.status).toBe(200)
    expect((res.body as SuccessBody<readonly PreferenceBody[]>).data).toEqual([])
  })

  it('PATCH promotions/telegram: is_enabled=false + тихие часы — сохраняется и отражается в GET', async () => {
    const userId = await seedUser()
    const token = sign(userId)

    const patched = await patchPreferences(token, {
      preferences: [{ category: 'promotions', channel: 'telegram', isEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00' }],
    })

    expect(patched.status).toBe(200)
    const patchedData = (patched.body as SuccessBody<readonly PreferenceBody[]>).data
    expect(patchedData).toEqual([
      expect.objectContaining({ category: 'promotions', channel: 'telegram', isEnabled: false, quietHoursStart: '22:00:00', quietHoursEnd: '08:00:00' }),
    ])

    const after = await getPreferences(token)
    expect((after.body as SuccessBody<readonly PreferenceBody[]>).data).toEqual(patchedData)
  })

  it('критерий приёмки 3: попытка отключить order_updates ИГНОРИРУЕТСЯ (поле), остальные позиции ПАТЧа применяются — не 400', async () => {
    const userId = await seedUser()
    const token = sign(userId)

    const res = await patchPreferences(token, {
      preferences: [
        { category: 'order_updates', channel: 'telegram', isEnabled: false },
        { category: 'promotions', channel: 'sms', quietHoursStart: '23:00', quietHoursEnd: '07:00' },
      ],
    })

    expect(res.status).toBe(200)
    const data = (res.body as SuccessBody<readonly PreferenceBody[]>).data
    const orderUpdates = data.find((p) => p.category === 'order_updates')
    const promotions = data.find((p) => p.category === 'promotions')
    expect(orderUpdates?.isEnabled).toBe(true) // попытка false — тихо проигнорирована
    expect(promotions).toMatchObject({ quietHoursStart: '23:00:00', quietHoursEnd: '07:00:00' })
  })

  it('чужие настройки структурно недостижимы: GET другого пользователя не видит патч первого', async () => {
    const userA = await seedUser()
    const userB = await seedUser()
    await patchPreferences(sign(userA), { preferences: [{ category: 'promotions', channel: 'telegram', isEnabled: false }] })

    const resB = await getPreferences(sign(userB))

    expect(resB.status).toBe(200)
    expect((resB.body as SuccessBody<readonly PreferenceBody[]>).data).toEqual([])
  })

  it('невалидный quietHoursStart ("25:00") → 400 VALIDATION_ERROR, ничего не сохранено', async () => {
    const userId = await seedUser()
    const token = sign(userId)

    const res = await patchPreferences(token, {
      preferences: [{ category: 'promotions', channel: 'telegram', quietHoursStart: '25:00', quietHoursEnd: '08:00' }],
    })

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')

    const after = await getPreferences(token)
    expect((after.body as SuccessBody<readonly PreferenceBody[]>).data).toEqual([])
  })
})
