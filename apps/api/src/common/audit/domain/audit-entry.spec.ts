/**
 * `AuditEntry` (EP-16, DTJ-374) — unit-тест конструктора/фабрики. Тест-план тикета:
 * валидация `metadata` против списка запрещённых полей — таблица кейсов (AC3).
 */
import { describe, expect, it } from 'vitest'
import { AuditEntry, type AuditEntryProps } from './audit-entry.js'
import { SensitiveMetadataFieldError } from './errors/sensitive-metadata-field.error.js'

function baseProps(overrides: Partial<AuditEntryProps> = {}): AuditEntryProps {
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

describe('AuditEntry.create (DTJ-374, SRS-ADM-062/063/064)', () => {
  it('создаёт валидную запись с минимальной дельтой before/after', () => {
    const entry = AuditEntry.create(baseProps())
    expect(entry.category).toBe('role_grant')
    expect(entry.entityId).toBe('user-1')
    expect(entry.reason).toBeNull()
    expect(entry.metadata).toEqual({ before: { role: 'customer' }, after: { role: 'super_admin' } })
  })

  it('reason опущен → null (не undefined, симметрично EscrowLedgerEntry)', () => {
    const entry = AuditEntry.create(baseProps())
    expect(entry.reason).toBeNull()
  })

  it('reason передан → сохраняется как есть', () => {
    const entry = AuditEntry.create(baseProps({ reason: 'спор урегулирован' }))
    expect(entry.reason).toBe('спор урегулирован')
  })

  it('actorUserId/tenantId могут быть null (системное действие / кросс-тенантное)', () => {
    const entry = AuditEntry.create(baseProps({ actorUserId: null, tenantId: null }))
    expect(entry.actorUserId).toBeNull()
    expect(entry.tenantId).toBeNull()
  })

  describe('AC3 — metadata с запрещённым полем отклоняется доменной ошибкой', () => {
    it('metadata.extra.apiKey → SensitiveMetadataFieldError (буквальный кейс AC3 тикета)', () => {
      expect(() => AuditEntry.create(baseProps({ metadata: { extra: { apiKey: 'x' } } }))).toThrow(
        SensitiveMetadataFieldError,
      )
    })

    it.each([
      ['before', { before: { password: 'x' } }],
      ['after', { after: { hmacSecret: 'x' } }],
      ['extra', { extra: { codeHash: 'x' } }],
    ])('запрещённое поле в %s отклоняется', (_label, metadata) => {
      expect(() => AuditEntry.create(baseProps({ metadata }))).toThrow(SensitiveMetadataFieldError)
    })

    it('запрещённое поле ВЛОЖЕНО глубже верхнего уровня — тоже отклоняется (рекурсивная проверка)', () => {
      expect(() =>
        AuditEntry.create(baseProps({ metadata: { after: { profile: { password: 'x' } } } })),
      ).toThrow(SensitiveMetadataFieldError)
    })

    it('запрещённое поле внутри массива — тоже отклоняется', () => {
      expect(() =>
        AuditEntry.create(baseProps({ metadata: { extra: { items: [{ apiKey: 'x' }] } } })),
      ).toThrow(SensitiveMetadataFieldError)
    })

    it('ПОЛНЫЙ снепшот пользователя (не только дельта) обычно несёт password-подобное поле — тоже отклоняется (дисциплина вызывающего кода, SRS-ADM-063)', () => {
      const fullUserSnapshot = { id: 'user-1', role: 'customer', phone: '+992900000000', password: 'hash' }
      expect(() => AuditEntry.create(baseProps({ metadata: { before: fullUserSnapshot } }))).toThrow(
        SensitiveMetadataFieldError,
      )
    })

    it('ошибка несёт имя поля и код (для логирования/алертинга)', () => {
      try {
        AuditEntry.create(baseProps({ metadata: { extra: { apiKey: 'x' } } }))
        throw new Error('expected to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(SensitiveMetadataFieldError)
        const e = error as SensitiveMetadataFieldError
        expect(e.fieldName).toBe('apiKey')
        expect(e.code).toBe('AUDIT_LOG_SENSITIVE_METADATA_FIELD')
        expect(e.name).toBe('SensitiveMetadataFieldError')
      }
    })
  })

  it('metadata без before/after/extra (все опущены) — валидна', () => {
    const entry = AuditEntry.create(baseProps({ metadata: {} }))
    expect(entry.metadata).toEqual({})
  })
})
