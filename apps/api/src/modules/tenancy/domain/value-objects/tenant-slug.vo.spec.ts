import { describe, it, expect } from 'vitest'
import { TenantSlug, RESERVED_SLUGS } from './tenant-slug.vo.js'
import { ValidationError } from '@dorutj/contracts'

describe('TenantSlug VO', () => {
  it('accepts a valid lowercase slug', () => {
    const slug = TenantSlug.parse('sifat-pharma')
    expect(slug.value).toBe('sifat-pharma')
  })

  it('accepts the minimum-length slug (3 chars)', () => {
    const slug = TenantSlug.parse('abc')
    expect(slug.value).toBe('abc')
  })

  it('accepts the maximum-length slug (32 chars)', () => {
    const slug = TenantSlug.parse('a2345678901234567890123456789012'.slice(0, 32))
    expect(slug.value).toHaveLength(32)
  })

  it('rejects a slug shorter than 3 chars', () => {
    expect(() => TenantSlug.parse('ab')).toThrow(ValidationError)
  })

  it('rejects a slug longer than 32 chars', () => {
    expect(() => TenantSlug.parse('a'.repeat(33))).toThrow(ValidationError)
  })

  it('rejects uppercase characters', () => {
    expect(() => TenantSlug.parse('Sifat')).toThrow(ValidationError)
  })

  it('rejects characters outside [a-z0-9-]', () => {
    expect(() => TenantSlug.parse('sifat_pharma')).toThrow(ValidationError)
    expect(() => TenantSlug.parse('sifat.pharma')).toThrow(ValidationError)
  })

  it('marks all six reserved slugs as reserved', () => {
    for (const reserved of RESERVED_SLUGS) {
      const slug = TenantSlug.parse(reserved)
      expect(slug.isReserved()).toBe(true)
    }
  })

  it('marks a non-reserved slug as not reserved', () => {
    const slug = TenantSlug.parse('sifat-pharma')
    expect(slug.isReserved()).toBe(false)
  })

  it('compares by value', () => {
    expect(TenantSlug.parse('abc').equals(TenantSlug.parse('abc'))).toBe(true)
    expect(TenantSlug.parse('abc').equals(TenantSlug.parse('abd'))).toBe(false)
  })
})
