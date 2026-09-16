/**
 * `AuditLogRepository` (EP-16, DTJ-374) — unit-тест поверх мокнутого `DrizzleDb.execute`
 * (тот же приём, что `catalog/infrastructure/adapters/postgres-pharmacy-map.adapter.spec.ts`:
 * реальный round-trip — на настоящем Postgres, см. `test/integration/common/audit/
 * audit-log-repository.e2e.spec.ts`, здесь — только форма поведения класса).
 *
 * Проверяет:
 *  1. `write()` вызывает `db.execute` РОВНО ОДИН РАЗ для валидного входа — «`write()` выполняет
 *     ТОЛЬКО `INSERT`» (п.4 тикета) в терминах наблюдаемого поведения, не парсинга SQL-текста.
 *  2. `write()` с запрещённым полем `metadata` НЕ вызывает `db.execute` вовсе — домен отклоняет
 *     запись ДО попытки `INSERT` (defense-in-depth срабатывает раньше похода в БД).
 *  3. `maskSensitiveMetadataFields` — чистая функция, маскирует запрещённые поля рекурсивно.
 */
import { describe, expect, it, vi } from 'vitest'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AuditLogRepository, MASKED_METADATA_VALUE, maskSensitiveMetadataFields } from './audit-log.repository.js'
import { type AuditEntryInput } from '../audit-log.port.js'
import { SensitiveMetadataFieldError } from '../domain/errors/sensitive-metadata-field.error.js'

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

describe('maskSensitiveMetadataFields (defense-in-depth, второй рубеж после AuditEntry.create)', () => {
  it('маскирует запрещённое поле верхнего уровня', () => {
    expect(maskSensitiveMetadataFields({ apiKey: 'secret', ok: 1 })).toEqual({
      apiKey: MASKED_METADATA_VALUE,
      ok: 1,
    })
  })

  it('маскирует запрещённое поле, вложенное глубже верхнего уровня', () => {
    expect(maskSensitiveMetadataFields({ profile: { password: 'x' } })).toEqual({
      profile: { password: MASKED_METADATA_VALUE },
    })
  })

  it('маскирует запрещённое поле внутри массива объектов', () => {
    expect(maskSensitiveMetadataFields({ items: [{ hmacSecret: 'x' }, { ok: true }] })).toEqual({
      items: [{ hmacSecret: MASKED_METADATA_VALUE }, { ok: true }],
    })
  })

  it('не трогает значения без запрещённых ключей', () => {
    const value = { role: 'customer', count: 3, list: [1, 2, 3] }
    expect(maskSensitiveMetadataFields(value)).toEqual(value)
  })

  it('примитивы и null возвращаются как есть', () => {
    expect(maskSensitiveMetadataFields(null)).toBeNull()
    expect(maskSensitiveMetadataFields('x')).toBe('x')
  })
})
