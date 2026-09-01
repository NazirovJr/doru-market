import { describe, it, expect } from 'vitest'
import { TenantId } from './tenant-id.vo.js'
import { ValidationError } from '@dorutj/contracts'

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('TenantId VO', () => {
  it('accepts a valid UUID', () => {
    const id = TenantId.from(VALID_UUID)
    expect(id.value).toBe(VALID_UUID)
  })

  it('rejects an empty string', () => {
    expect(() => TenantId.from('')).toThrow(ValidationError)
  })

  it('rejects a non-UUID string', () => {
    expect(() => TenantId.from('not-a-uuid')).toThrow(ValidationError)
  })

  it('rejects a string of wrong length', () => {
    expect(() => TenantId.from('550e8400-e29b-41d4-a716-44665544000')).toThrow(ValidationError)
  })

  it('compares equal by value', () => {
    const a = TenantId.from(VALID_UUID)
    const b = TenantId.from(VALID_UUID)
    expect(a.equals(b)).toBe(true)
  })

  it('compares unequal for different values', () => {
    const a = TenantId.from(VALID_UUID)
    // Версия/вариант-нибблы (`4`/`8`) обязательны — `uuid`'s `validate()`
    // проверяет RFC 9562 формат строго, `...-0000-...-0000-...` не проходит.
    const b = TenantId.from('00000000-0000-4000-8000-000000000001')
    expect(a.equals(b)).toBe(false)
  })
})
