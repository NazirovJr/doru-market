/**
 * `AuditLogRepository` — unit-тест поверх мокнутого `DrizzleDb.execute` (реальный round-trip —
 * `test/integration/common/audit/audit-log-repository.e2e.spec.ts`).
 *
 * Проверяет:
 *  1. `write()` вызывает `db.execute` ровно один раз для валидного входа.
 *  2. Запрещённое поле `metadata` → домен отклоняет ДО `INSERT`, `db.execute` не вызван.
 *  3. `write()` вызывает общий `maskSensitiveFields` перед `INSERT` — `@dorutj/contracts` мокнут
 *     частично (реализация сохранена, она уже покрыта `sensitive-fields.spec.ts`), проверяется
 *     только факт вызова и что в БД попадает именно его результат.
 */
import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type * as DorutjContracts from '@dorutj/contracts'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AuditLogRepository } from './audit-log.repository.js'
import { type AuditEntryInput } from '../audit-log.port.js'
import { SensitiveMetadataFieldError } from '../domain/errors/sensitive-metadata-field.error.js'

const dialect = new PgDialect()

/** Текст SQL + позиционные параметры (`$1, $2, ...`) — тот же приём, что `postgres-search.sql.spec.ts`
 *  (`PgDialect.sqlToQuery`, надёжнее ручного обхода `queryChunks` — литералы там `StringChunk`, не `string`). */
function renderSql(query: SQL): { readonly sql: string; readonly params: readonly unknown[] } {
  return dialect.sqlToQuery(query)
}

vi.mock('@dorutj/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof DorutjContracts>()
  return { ...actual, maskSensitiveFields: vi.fn(actual.maskSensitiveFields) }
})

const contracts = await import('@dorutj/contracts')
const maskSensitiveFieldsSpy = contracts.maskSensitiveFields as unknown as ReturnType<typeof vi.fn>

/** Находим JSON-параметр metadata среди queryChunks по форме значения, не по индексу. */
function insertedMetadata(execute: ReturnType<typeof vi.fn>): unknown {
  const call = execute.mock.calls[0] as [{ queryChunks: readonly unknown[] }] | undefined
  if (call === undefined) throw new Error('db.execute was not called')
  const jsonParam = call[0].queryChunks.find(
    (chunk): chunk is string => typeof chunk === 'string' && chunk.startsWith('{'),
  )
  if (jsonParam === undefined) throw new Error('metadata param not found among queryChunks')
  return JSON.parse(jsonParam)
}

function validInput(overrides: Partial<AuditEntryInput> = {}): AuditEntryInput {
  return {
    category: 'role_grant',
    entityType: 'user',
    entityId: 'user-1',
    actorUserId: 'admin-1',
    action: 'grant_platform_role',
    metadata: { before: { role: 'customer' }, after: { role: 'super_admin' } },
    requestId: 'req-1',
    tenantId: null,
    ...overrides,
  }
}

function makeRepository(): { repository: AuditLogRepository; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue(undefined)
  const db = { execute } as unknown as DrizzleDb
  return { repository: new AuditLogRepository(db), execute }
}

describe('AuditLogRepository.write (DTJ-374, SRS-ADM-063/064)', () => {
  it('валидный вход → db.execute вызван ровно один раз (только INSERT)', async () => {
    const { repository, execute } = makeRepository()
    await repository.write(validInput())
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('metadata.extra.apiKey → отклонено доменом, db.execute НЕ вызван вовсе', async () => {
    const { repository, execute } = makeRepository()
    await expect(repository.write(validInput({ metadata: { extra: { apiKey: 'x' } } }))).rejects.toThrow(
      SensitiveMetadataFieldError,
    )
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('AuditLogRepository.write — вызывает maskSensitiveFields перед INSERT (DTJ-375, AC3)', () => {
  it('вызывает maskSensitiveFields РОВНО ОДИН РАЗ с metadata + requestId', async () => {
    const { repository } = makeRepository()
    maskSensitiveFieldsSpy.mockClear()

    await repository.write(validInput({ metadata: { before: { role: 'customer' }, after: { role: 'super_admin' } } }))

    expect(maskSensitiveFieldsSpy).toHaveBeenCalledTimes(1)
    expect(maskSensitiveFieldsSpy).toHaveBeenCalledWith({
      before: { role: 'customer' },
      after: { role: 'super_admin' },
      requestId: 'req-1',
    })
  })

  it('РЕЗУЛЬТАТ maskSensitiveFields — то, что реально попадает в INSERT (не сырое metadata)', async () => {
    const { repository, execute } = makeRepository()
    maskSensitiveFieldsSpy.mockClear()
    maskSensitiveFieldsSpy.mockReturnValueOnce({ marker: 'stub-masked-result' })

    await repository.write(validInput())

    expect(insertedMetadata(execute)).toEqual({ marker: 'stub-masked-result' })
  })

  it('metadata без чувствительных полей — записывается без изменений (кроме добавленного requestId)', async () => {
    const { repository, execute } = makeRepository()
    maskSensitiveFieldsSpy.mockClear()

    await repository.write(validInput({ metadata: { before: { role: 'customer' }, after: { role: 'super_admin' } } }))

    const metadata = insertedMetadata(execute)
    expect(metadata).toEqual({ before: { role: 'customer' }, after: { role: 'super_admin' }, requestId: 'req-1' })
  })
})

describe('AuditLogRepository.findByFilters (DTJ-376)', () => {
  function rowFixture(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      id: 'entry-1',
      category: 'payment_override',
      entity_type: 'order',
      entity_id: 'order-1',
      actor_user_id: 'admin-1',
      action: 'admin_payment_override',
      reason: null,
      metadata: { requestId: 'req-1' },
      request_id: 'req-1',
      tenant_id: 'tenant-1',
      created_at: '2026-08-15T00:00:00.000Z',
      ...overrides,
    }
  }

  it('без фильтров/курсора — один SELECT, limit+1, hasMore=false, когда строк не больше limit', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [rowFixture()] })
    const db = { execute } as unknown as DrizzleDb
    const repository = new AuditLogRepository(db)

    const page = await repository.findByFilters({ filter: {}, limit: 20, cursor: null })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toEqual({
      id: 'entry-1',
      category: 'payment_override',
      entityType: 'order',
      entityId: 'order-1',
      actorUserId: 'admin-1',
      action: 'admin_payment_override',
      reason: null,
      metadata: { requestId: 'req-1' },
      requestId: 'req-1',
      tenantId: 'tenant-1',
      createdAt: new Date('2026-08-15T00:00:00.000Z'),
    })
  })

  it('db.execute вернул результат-массив напрямую (не {rows: [...]}) — тоже читается', async () => {
    const execute = vi.fn().mockResolvedValue([rowFixture()])
    const db = { execute } as unknown as DrizzleDb
    const repository = new AuditLogRepository(db)

    const page = await repository.findByFilters({ filter: {}, limit: 20, cursor: null })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.id).toBe('entry-1')
  })

  it('db.execute вернул форму без .rows и не массив — пустая страница, не падение', async () => {
    const execute = vi.fn().mockResolvedValue({ unexpected: 'shape' })
    const db = { execute } as unknown as DrizzleDb
    const repository = new AuditLogRepository(db)

    const page = await repository.findByFilters({ filter: {}, limit: 20, cursor: null })

    expect(page.items).toEqual([])
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('строк больше limit — hasMore=true, nextCursor из последней строки СТРАНИЦЫ (не отброшенной limit+1-й)', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [rowFixture({ id: 'entry-1' }), rowFixture({ id: 'entry-2', created_at: '2026-08-14T00:00:00.000Z' })],
    })
    const db = { execute } as unknown as DrizzleDb
    const repository = new AuditLogRepository(db)

    const page = await repository.findByFilters({ filter: {}, limit: 1, cursor: null })

    expect(page.hasMore).toBe(true)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.id).toBe('entry-1')
    expect(page.nextCursor).toEqual({ v: '2026-08-15T00:00:00.000Z', id: 'entry-1' })
  })

  it('критерий приёмки 3 — комбинация category+createdAtFrom попадает В ОДИН SQL-запрос (WHERE ... AND ...)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    const db = { execute } as unknown as DrizzleDb
    const repository = new AuditLogRepository(db)

    await repository.findByFilters({
      filter: { category: 'payment_override', createdAtFrom: new Date('2026-08-01T00:00:00.000Z') },
      limit: 20,
      cursor: null,
    })

    expect(execute).toHaveBeenCalledTimes(1)
    const call = execute.mock.calls[0] as [SQL]
    const { sql: queryText, params } = renderSql(call[0])
    expect(queryText).toContain('category =')
    expect(queryText).toContain('created_at >=')
    expect(queryText).toContain('AND')
    expect(params).toContain('payment_override')
  })

  it('cursor передан — SQL несёт keyset-условие (created_at < ... OR (created_at = ... AND id < ...))', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    const db = { execute } as unknown as DrizzleDb
    const repository = new AuditLogRepository(db)

    await repository.findByFilters({ filter: {}, limit: 20, cursor: { v: '2026-08-01T00:00:00.000Z', id: 'anchor' } })

    const call = execute.mock.calls[0] as [SQL]
    const { sql: queryText, params } = renderSql(call[0])
    expect(queryText).toContain('created_at <')
    expect(queryText).toContain('id <')
    expect(params).toContain('anchor')
  })

  it('без фильтров/курсора — SQL БЕЗ WHERE вовсе (не пустой WHERE TRUE)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] })
    const db = { execute } as unknown as DrizzleDb
    const repository = new AuditLogRepository(db)

    await repository.findByFilters({ filter: {}, limit: 20, cursor: null })

    const call = execute.mock.calls[0] as [SQL]
    const { sql: queryText } = renderSql(call[0])
    expect(queryText).not.toContain('WHERE')
  })
})
