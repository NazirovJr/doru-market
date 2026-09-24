/**
 * `AuditLogRepository` (EP-16, DTJ-374/375) — unit-тест поверх мокнутого `DrizzleDb.execute`
 * (тот же приём, что `catalog/infrastructure/adapters/postgres-pharmacy-map.adapter.spec.ts`:
 * реальный round-trip — на настоящем Postgres, см. `test/integration/common/audit/
 * audit-log-repository.e2e.spec.ts`, здесь — только форма поведения класса).
 *
 * Проверяет:
 *  1. `write()` вызывает `db.execute` РОВНО ОДИН РАЗ для валидного входа — «`write()` выполняет
 *     ТОЛЬКО `INSERT`» (п.4 тикета) в терминах наблюдаемого поведения, не парсинга SQL-текста.
 *  2. `write()` с запрещённым полем `metadata` НЕ вызывает `db.execute` вовсе — домен отклоняет
 *     запись ДО попытки `INSERT` (defense-in-depth срабатывает раньше похода в БД).
 *  3. `write()` вызывает ЕДИНЫЙ `maskSensitiveFields` (`@dorutj/contracts`, DTJ-375) на metadata
 *     ПЕРЕД `INSERT` — второй, defense-in-depth рубеж (AC3 DTJ-375). Тест мокает
 *     `@dorutj/contracts` частично (`vi.mock` + `importOriginal`), сохраняя РЕАЛЬНУЮ реализацию
 *     функции (она уже исчерпывающе покрыта `sensitive-fields.spec.ts`) — здесь проверяется
 *     ТОЛЬКО факт вызова и то, что именно ЕЁ результат попадает в `INSERT`, а не повторяется
 *     алгоритм маскирования. `password`/`apiKey`/… в СУЩЕСТВУЮЩЕМ `metadata` домен (`AuditEntry.
 *     create`) отклоняет ДО репозитория (ЕДИНЫЙ список — риск C15), поэтому реальный вход
 *     `write()` физически не может достичь маскирования с запрещённым полем — это ОСОЗНАННАЯ
 *     асимметрия (см. «Риски» DTJ-375, JSDoc `audit-log.repository.ts`): маскирование остаётся
 *     страховкой на случай будущей регрессии в вызове `AuditEntry.create()`, а не основным путём.
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

/** `metadata` — единственный `::jsonb`-параметр `sql` template-тега, сериализованный в JSON
 * (см. JSDoc `audit-log.repository.ts`) — находим его среди `queryChunks` по форме значения,
 * не по позиционному индексу (устойчиво к порядку колонок INSERT). */
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
