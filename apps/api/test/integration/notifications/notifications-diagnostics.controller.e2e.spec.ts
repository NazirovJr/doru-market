// Supertest integration NotificationsDiagnosticsController против реальных Postgres/Redis.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import IORedis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { UserRole } from '@dorutj/contracts'
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
  readonly meta?: { readonly pagination?: { readonly hasMore: boolean; readonly nextCursor: string | null } }
}
interface ErrorBody {
  readonly error: { readonly code: string }
}
interface UndeliveredBody {
  readonly userId: string
  readonly eventType: string
  readonly sourceEventId: string
  readonly attempts: readonly { readonly channel: string; readonly status: string }[]
}

const TENANT_ID = randomUUID()

describe.skipIf(!postgresAvailable || !redisAvailable)('NotificationsDiagnosticsController — Supertest integration (DTJ-373)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  const createdUserIds: string[] = []

  function sign(sub: string, role: UserRole): string {
    return jwtSigner.sign({ sub, role, tenantId: TENANT_ID, pharmacyId: null, chainId: null, sessionId: randomUUID() })
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

  async function seedNotification(input: {
    readonly userId: string
    readonly eventType: string
    readonly sourceEventId: string
    readonly channel: string
    readonly status: string
    readonly failedReason?: string
  }): Promise<void> {
    await pool.query(
      `INSERT INTO notifications (user_id, tenant_id, channel, event_type, status, payload, source_event_id, failed_reason)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7)`,
      [input.userId, TENANT_ID, input.channel, input.eventType, input.status, input.sourceEventId, input.failedReason ?? null],
    )
  }

  function getUndelivered(token: string): request.Test {
    return request(httpServer).get('/api/v1/notifications/undelivered').set('Authorization', `Bearer ${token}`)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      `test-dtj373-${TENANT_ID.slice(0, 8)}`,
    ])
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale) VALUES ($1, 'DTJ-373 e2e', '{}'::jsonb, 'tj') ON CONFLICT (tenant_id) DO NOTHING`,
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
      await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [TENANT_ID])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  it('pharmacy_admin → 403 INSUFFICIENT_ROLE до входа в use case (критерий приёмки 3)', async () => {
    const userId = await seedUser()
    const res = await getUndelivered(sign(userId, 'pharmacy_admin'))

    expect(res.status).toBe(403)
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
  })

  it('все внешние каналы события провалились (telegram, sms, web_push failed) — пользователь ЕСТЬ в списке, все попытки видны', async () => {
    const userId = await seedUser()
    const sourceEventId = randomUUID()
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'telegram', status: 'failed', failedReason: 'нет telegram_chat_id' })
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'sms', status: 'failed', failedReason: 'провайдер не реализован' })
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'web_push', status: 'failed', failedReason: 'провайдер не реализован' })
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'in_app', status: 'sent' })

    const res = await getUndelivered(sign(userId, 'super_admin'))

    expect(res.status).toBe(200)
    const data = (res.body as SuccessBody<readonly UndeliveredBody[]>).data
    const group = data.find((g) => g.userId === userId)
    expect(group).toBeDefined()
    expect(group?.eventType).toBe('order.paid')
    expect(group?.attempts.map((a) => `${a.channel}:${a.status}`).sort()).toEqual(
      ['in_app:sent', 'sms:failed', 'telegram:failed', 'web_push:failed'].sort(),
    )
  })

  it('критерий приёмки 1: telegram/sms failed, НО последний канал web_push доставлен — пользователь НЕ в списке', async () => {
    const userId = await seedUser()
    const sourceEventId = randomUUID()
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'telegram', status: 'failed', failedReason: 'нет telegram_chat_id' })
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'sms', status: 'failed', failedReason: 'провайдер не реализован' })
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'web_push', status: 'delivered' })
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'in_app', status: 'sent' })

    const res = await getUndelivered(sign(userId, 'super_admin'))

    expect(res.status).toBe(200)
    const data = (res.body as SuccessBody<readonly UndeliveredBody[]>).data
    expect(data.find((g) => g.userId === userId)).toBeUndefined()
  })

  it('критерий приёмки 2: единственная строка — in_app (гарантированный синхронный канал), внешние каналы вообще не создавались — пользователь НЕ в списке', async () => {
    const userId = await seedUser()
    const sourceEventId = randomUUID()
    await seedNotification({ userId, eventType: 'order.paid', sourceEventId, channel: 'in_app', status: 'sent' })

    const res = await getUndelivered(sign(userId, 'super_admin'))

    expect(res.status).toBe(200)
    const data = (res.body as SuccessBody<readonly UndeliveredBody[]>).data
    expect(data.find((g) => g.userId === userId)).toBeUndefined()
  })
})
