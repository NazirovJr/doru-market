// Supertest integration AuditLogController против реальных Postgres/Redis.
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { UserRole } from '@dorutj/contracts'
import { JWT_SIGNER, type JwtClaims, type JwtSignerPort } from '@/modules/auth/index.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { SensitiveMetadataFieldError } from '@/common/audit/domain/errors/sensitive-metadata-field.error.js'
import { createTestApp, type TestApp } from './__tests__/audit-log-test-app.js'

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
  readonly meta?: { pagination?: { nextCursor: string | null; hasMore: boolean; limit: number } }
}
interface ErrorBody {
  readonly error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
}
interface AuditLogEntryBody {
  readonly id: string
  readonly category: string
  readonly entityType: string
  readonly entityId: string
  readonly actorUserId: string | null
  readonly action: string
  readonly reason: string | null
  readonly metadata: Record<string, unknown>
  readonly tenantId: string | null
  readonly createdAt: string
}

const TENANT_ID = randomUUID()
const NON_SUPER_ADMIN_ROLES: readonly UserRole[] = ['customer', 'pharmacist', 'pharmacy_admin', 'courier', 'support_agent']

describe.skipIf(!postgresAvailable)('AuditLogController — Supertest integration (DTJ-376)', () => {
  let pool: Pool
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let jwtSigner: JwtSignerPort
  let repository: AuditLogPort
  let superAdminToken: string
  const createdUserIds: string[] = []
  const createdEntityIds: string[] = []

  function sign(claims: Omit<JwtClaims, 'sessionId'>): string {
    return jwtSigner.sign({ ...claims, sessionId: randomUUID() })
  }

  async function seedUser(role: UserRole): Promise<string> {
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

  function getAuditLog(token: string, query = ''): request.Test {
    return request(httpServer)
      .get(`/api/v1/audit-log${query}`)
      .set('Authorization', `Bearer ${token}`)
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false) ON CONFLICT (id) DO NOTHING`, [
      TENANT_ID,
      `test-audit-log-376-${TENANT_ID.slice(0, 8)}`,
    ])
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale) VALUES ($1, 'Operator', '{}'::jsonb, 'tj') ON CONFLICT (tenant_id) DO NOTHING`,
      [TENANT_ID],
    )
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    jwtSigner = app.get<JwtSignerPort>(JWT_SIGNER)
    repository = app.get<AuditLogPort>(AUDIT_LOG_PORT)
    const superAdminId = await seedUser('super_admin')
    superAdminToken = sign({ sub: superAdminId, role: 'super_admin', tenantId: null, pharmacyId: null, chainId: null })
  })

  afterAll(async () => {
    try {
      await ctx.close()
    } finally {
      await pool.query('DELETE FROM audit_log WHERE entity_id = ANY($1)', [createdEntityIds])
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
      }
      await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [TENANT_ID])
      await pool.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID])
      await pool.end().catch(() => undefined)
    }
  })

  async function seedEntry(overrides: {
    category: string
    action: string
    entityType?: string
    createdAt?: Date
    reason?: string
  }): Promise<string> {
    const entityId = randomUUID()
    createdEntityIds.push(entityId)
    await repository.write({
      category: overrides.category,
      entityType: overrides.entityType ?? 'order',
      entityId,
      actorUserId: null,
      action: overrides.action,
      ...(overrides.reason !== undefined && { reason: overrides.reason }),
      metadata: { extra: { note: 'seed DTJ-376' } },
      requestId: randomUUID(),
      tenantId: TENANT_ID,
    })
    if (overrides.createdAt !== undefined) {
      await pool.query(`UPDATE audit_log SET created_at = $1 WHERE entity_id = $2`, [overrides.createdAt, entityId])
    }
    return entityId
  }

  it('АС1 — super_admin GET /audit-log видит созданные записи, пагинация в meta', async () => {
    await seedEntry({ category: 'ledger_adjustment', action: 'seed_ac1' })

    const res = await getAuditLog(superAdminToken, '?limit=50')

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly AuditLogEntryBody[]>
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.meta?.pagination).toBeDefined()
    expect(body.data.some((entry) => entry.action === 'seed_ac1')).toBe(true)
  })

  it.each(NON_SUPER_ADMIN_ROLES)(
    'АС1/АС2 — роль "%s" → 403 INSUFFICIENT_ROLE на уровне guard, ДО входа в use case (нет "своя запись" исключений)',
    async (role) => {
      const userId = await seedUser(role)
      const token = sign({ sub: userId, role, tenantId: TENANT_ID, pharmacyId: null, chainId: null })

      const res = await getAuditLog(token, '?limit=20')

      expect(res.status).toBe(403)
      expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_ROLE')
    },
  )

  it('АС3 — category+createdAtFrom комбинируются одновременно (AND, не только по одному полю)', async () => {
    await seedEntry({
      category: 'payment_override',
      action: 'seed_ac3_match',
      createdAt: new Date('2026-08-15T00:00:00.000Z'),
    })
    // Тот же category, но ДО createdAtFrom — не должна попасть в результат.
    await seedEntry({ category: 'payment_override', action: 'seed_ac3_too_old', createdAt: new Date('2026-07-01T00:00:00.000Z') })
    // В диапазоне дат, но другая category — не должна попасть.
    await seedEntry({ category: 'return_override', action: 'seed_ac3_wrong_category', createdAt: new Date('2026-08-20T00:00:00.000Z') })

    const res = await getAuditLog(superAdminToken, '?limit=50&category=payment_override&createdAtFrom=2026-08-01')

    expect(res.status).toBe(200)
    const body = res.body as SuccessBody<readonly AuditLogEntryBody[]>
    const actions = body.data.map((entry) => entry.action)
    expect(actions).toContain('seed_ac3_match')
    expect(actions).not.toContain('seed_ac3_too_old')
    expect(actions).not.toContain('seed_ac3_wrong_category')
    expect(body.data.every((entry) => entry.category === 'payment_override')).toBe(true)
  })

  it('невалидный cursor → 400 INVALID_CURSOR', async () => {
    const res = await getAuditLog(superAdminToken, '?limit=20&cursor=not-a-valid-cursor!!!')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('INVALID_CURSOR')
  })

  it('невалидный limit (=0 и >100) → 400 VALIDATION_ERROR', async () => {
    const tooLow = await getAuditLog(superAdminToken, '?limit=0')
    const tooHigh = await getAuditLog(superAdminToken, '?limit=101')

    expect(tooLow.status).toBe(400)
    expect((tooLow.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    expect(tooHigh.status).toBe(400)
    expect((tooHigh.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('невалидный category (не из audit_action_category) → 400 VALIDATION_ERROR, не 500 от БД', async () => {
    const res = await getAuditLog(superAdminToken, '?limit=20&category=not-a-real-category')

    expect(res.status).toBe(400)
    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
  })

  it('metadata не несёт чувствительных полей — write() отклоняет ДО INSERT (SRS-ADM-064), экран не может увидеть то, чего нет в БД', async () => {
    await expect(
      repository.write({
        category: 'ledger_adjustment',
        entityType: 'order',
        entityId: randomUUID(),
        actorUserId: null,
        action: 'seed_sensitive_rejected',
        metadata: { extra: { apiKey: 'should-never-reach-db' } },
        requestId: randomUUID(),
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow(SensitiveMetadataFieldError)
  })

  it('обычная (не чувствительная) metadata round-trip: GET возвращает ровно то, что записал write() — экран не искажает данные', async () => {
    const entityId = await seedEntry({ category: 'dispute_resolution', action: 'seed_metadata_roundtrip' })

    const res = await getAuditLog(superAdminToken, '?limit=50&category=dispute_resolution')

    const entry = (res.body as SuccessBody<readonly AuditLogEntryBody[]>).data.find((row) => row.entityId === entityId)
    expect(entry?.metadata).toEqual({ extra: { note: 'seed DTJ-376' }, requestId: expect.any(String) as string })
  })
})
