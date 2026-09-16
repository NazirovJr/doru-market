/**
 * Интеграционный тест `AuditLogRepository` (EP-16, DTJ-374) — РЕАЛЬНЫЙ Postgres, тот же
 * приём подключения/пробы, что `payments/escrow-ledger.repository.integration.spec.ts`
 * (ближайший прецедент). Testcontainers не используется (D-EP09-14/31, решение архитектора).
 *
 * Проверяет:
 *  1. `write()` создаёт корректную строку `audit_log` — round-trip всех полей, включая
 *     дублирование `requestId` В метаданных (SRS-ADM-063) И отдельной колонкой
 *     `request_id` (`11-database-schema.md` §40).
 *  2. `before`/`after` содержат ТОЛЬКО изменившиеся поля (SRS-ADM-063) — переданный тестом
 *     ПОЛНЫЙ снепшот сущности (несущий `password`) НЕ проходит валидацию домена и строка НЕ
 *     появляется в `audit_log` — фиксирует дисциплину вызывающего кода на уровне контракта
 *     (буквальный кейс из тест-плана DTJ-374), а не просто «домен бросает исключение где-то».
 *  3. `actorUserId`/`tenantId` — nullable (системное/кросс-тенантное действие).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AuditLogRepository } from '@/common/audit/infrastructure/audit-log.repository.js'
import type { AuditEntryInput } from '@/common/audit/audit-log.port.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

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

interface AuditLogRow {
  category: string
  entity_type: string
  entity_id: string
  actor_user_id: string | null
  action: string
  reason: string | null
  metadata: { before?: Record<string, unknown>; after?: Record<string, unknown>; requestId?: string }
  request_id: string | null
  tenant_id: string | null
}

describe.skipIf(!postgresAvailable)('AuditLogRepository (DTJ-374)', () => {
  let pool: Pool
  let repository: AuditLogRepository
  let tenantId: string
  let actorUserId: string

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    repository = new AuditLogRepository(drizzle(pool))

    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
      tenantId,
      `dtj374-${tenantId.slice(0, 8)}`,
    ])
    actorUserId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'super_admin')`, [actorUserId, tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId])
    await pool.query('DELETE FROM users WHERE id = $1', [actorUserId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  // `category='control_category_change'` — существующее значение `audit_action_category`
  // (миграция `0034_support_tickets_audit_log.sql`). `'role_grant'` (SRS-ADM-030) ещё не
  // добавлено в enum — вводит будущий `DTJ-354` (`blocks` этого тикета); реальный INSERT с
  // ним сегодня упал бы `22P02`. `AuditEntry`/`AuditLogPort` не валидируют `category` (см.
  // JSDoc `domain/audit-entry.ts`) — эта проверка целиком на стороне БД-enum.
  function baseInput(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
    return {
      category: 'control_category_change',
      entityType: 'user',
      entityId: randomUUID(),
      actorUserId,
      action: 'grant_platform_role',
      reason: 'новый сотрудник поддержки',
      metadata: { before: { role: 'customer' }, after: { role: 'support_agent' } },
      requestId: randomUUID(),
      tenantId,
      ...overrides,
    }
  }

  it('write() создаёт корректную строку — round-trip всех полей, requestId дублирован в metadata И в отдельной колонке', async () => {
    const input = baseInput()
    await repository.write(input)

    const result = await pool.query<AuditLogRow>(`SELECT * FROM audit_log WHERE entity_id = $1`, [input.entityId])
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    if (row === undefined) throw new Error('audit_log row not found')

    expect(row.category).toBe('role_grant')
    expect(row.entity_type).toBe('user')
    expect(row.actor_user_id).toBe(actorUserId)
    expect(row.action).toBe('grant_platform_role')
    expect(row.reason).toBe('новый сотрудник поддержки')
    expect(row.tenant_id).toBe(tenantId)
    expect(row.request_id).toBe(input.requestId)
    expect(row.metadata).toEqual({ before: { role: 'customer' }, after: { role: 'support_agent' }, requestId: input.requestId })
  })

  it('actorUserId/tenantId = null — системное/кросс-тенантное действие сохраняется корректно', async () => {
    const input = baseInput({ actorUserId: null, tenantId: null })
    await repository.write(input)

    const result = await pool.query<AuditLogRow>(`SELECT actor_user_id, tenant_id FROM audit_log WHERE entity_id = $1`, [
      input.entityId,
    ])
    expect(result.rows[0]).toEqual({ actor_user_id: null, tenant_id: null })
  })

  it('ПОЛНЫЙ снепшот вместо дельты (несёт password) — домен отклоняет ДО INSERT, строка не появляется', async () => {
    const entityId = randomUUID()
    const fullSnapshot = { id: entityId, role: 'customer', phone: '+992900000000', password: 'hash' }

    await expect(repository.write(baseInput({ entityId, metadata: { before: fullSnapshot } }))).rejects.toThrow(
      /forbidden field/,
    )

    const result = await pool.query(`SELECT id FROM audit_log WHERE entity_id = $1`, [entityId])
    expect(result.rows).toHaveLength(0)
  })
})
