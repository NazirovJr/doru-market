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
import type * as DorutjContracts from '@dorutj/contracts'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AuditLogRepository } from './audit-log.repository.js'
import { type AuditEntryInput } from '../audit-log.port.js'
import { SensitiveMetadataFieldError } from '../domain/errors/sensitive-metadata-field.error.js'

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
