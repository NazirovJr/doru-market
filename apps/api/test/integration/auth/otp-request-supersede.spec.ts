// Повторный запрос кода после невведённого (в том числе истёкшего) — реальный Postgres
// с частичным уникальным индексом ux_otp_codes_uniq_active.
import { randomInt, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const PHONE_SUFFIX_MAX = 10_000_000
const MS_PER_MINUTE = 60_000

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

describe.skipIf(!postgresAvailable)('auth.otp-request — новый код отменяет прежний невведённый', () => {
  let ctx: TestApp
  let httpServer: Server
  let pool: Pool
  let tenantId: string

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    const neutral = await pool.query<{ id: string }>('SELECT id FROM tenants WHERE is_neutral LIMIT 1')
    const id = neutral.rows[0]?.id
    if (id === undefined) throw new Error('neutral tenant is not seeded')
    tenantId = id
    ctx = await createTestApp()
    httpServer = ctx.httpServer
  })

  afterAll(async () => {
    await ctx.close()
    await pool.end()
  })

  it('истёкший невведённый код не блокирует новый запрос: 202, старая строка помечена потреблённой', async () => {
    const phone = `+99290${String(randomInt(0, PHONE_SUFFIX_MAX)).padStart(7, '0')}`
    const staleId = randomUUID()
    const issuedAt = new Date(Date.now() - 30 * MS_PER_MINUTE)
    await pool.query(
      `INSERT INTO otp_codes (id, tenant_id, subject_ref, purpose, code_hash, issued_at, expires_at)
       VALUES ($1, $2, $3, 'login', $4, $5, $6)`,
      [staleId, tenantId, phone, 'a'.repeat(64), issuedAt, new Date(issuedAt.getTime() + 5 * MS_PER_MINUTE)],
    )

    const response = await request(httpServer).post('/api/v1/auth/otp/request').send({ phone })

    expect(response.status).toBe(202)
    const stale = await pool.query<{ consumed_at: Date | null }>('SELECT consumed_at FROM otp_codes WHERE id = $1', [staleId])
    expect(stale.rows[0]?.consumed_at).not.toBeNull()
  })
})
