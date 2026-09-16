import { describe, expect, it } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import { fixedDate } from '@/shared-kernel/testing/fixtures/fixed-date.fixture.js'
import { FeatureFlag, type FeatureFlagCreateCommand } from './feature-flag.entity.js'

const NOW = fixedDate('2026-06-01T00:00:00Z')
const TENANT_X = 'tenant-x'
const FLAG_KEY = 'prescription_ocr_pipeline_enabled'

function globalFlag(isEnabled: boolean, overrides: Partial<FeatureFlagCreateCommand> = {}): FeatureFlag {
  return FeatureFlag.create(
    { id: 'flag-global', flagKey: FLAG_KEY, scope: 'global', isEnabled, rolloutPercentage: 100, ...overrides },
    NOW,
  )
}

function tenantFlag(tenantId: string, isEnabled: boolean, overrides: Partial<FeatureFlagCreateCommand> = {}): FeatureFlag {
  return FeatureFlag.create(
    { id: `flag-${tenantId}`, flagKey: FLAG_KEY, scope: 'tenant', tenantId, isEnabled, rolloutPercentage: 100, ...overrides },
    NOW,
  )
}

describe('FeatureFlag.create()', () => {
  it('scope="tenant" без tenantId — бросает ValidationError (АС3 DTJ-352)', () => {
    expect(() =>
      FeatureFlag.create({ id: 'x', flagKey: FLAG_KEY, scope: 'tenant', isEnabled: true, rolloutPercentage: 100 }, NOW),
    ).toThrow(ValidationError)
  })

  it('scope="global" С tenantId — бросает ValidationError (обратное направление того же CHECK)', () => {
    expect(() =>
      FeatureFlag.create(
        { id: 'x', flagKey: FLAG_KEY, scope: 'global', tenantId: TENANT_X, isEnabled: true, rolloutPercentage: 100 },
        NOW,
      ),
    ).toThrow(ValidationError)
  })

  it.each([-1, 101])('rolloutPercentage=%i (вне 0..100) — бросает ValidationError', (rolloutPercentage) => {
    expect(() =>
      FeatureFlag.create({ id: 'x', flagKey: FLAG_KEY, scope: 'global', isEnabled: true, rolloutPercentage }, NOW),
    ).toThrow(ValidationError)
  })

  it('валидный global-флаг конструируется, tenantId=null', () => {
    const flag = globalFlag(false)
    expect(flag.scope).toBe('global')
    expect(flag.tenantId).toBeNull()
    expect(flag.isEnabled).toBe(false)
    expect(flag.updatedAt).toBe(NOW)
  })

  it('валидный tenant-флаг конструируется с указанным tenantId', () => {
    const flag = tenantFlag(TENANT_X, true)
    expect(flag.scope).toBe('tenant')
    expect(flag.tenantId).toBe(TENANT_X)
  })
})

describe('FeatureFlag.resolve() — таблица кейсов специфичности (АС1/АС2 DTJ-352)', () => {
  it('только global(true) → true', () => {
    expect(FeatureFlag.resolve([globalFlag(true)])).toBe(true)
  })

  it('только global(false) → false', () => {
    expect(FeatureFlag.resolve([globalFlag(false)])).toBe(false)
  })

  it('только tenant(true) → true', () => {
    expect(FeatureFlag.resolve([tenantFlag(TENANT_X, true)])).toBe(true)
  })

  it('только tenant(false) → false', () => {
    expect(FeatureFlag.resolve([tenantFlag(TENANT_X, false)])).toBe(false)
  })

  it('оба присутствуют: tenant(true) побеждает global(false) — АС1 DTJ-352', () => {
    expect(FeatureFlag.resolve([globalFlag(false), tenantFlag(TENANT_X, true)])).toBe(true)
  })

  it('оба присутствуют: tenant(false) побеждает global(true) (не просто "любой true")', () => {
    expect(FeatureFlag.resolve([globalFlag(true), tenantFlag(TENANT_X, false)])).toBe(false)
  })

  it('порядок кандидатов в массиве не влияет на результат', () => {
    expect(FeatureFlag.resolve([tenantFlag(TENANT_X, true), globalFlag(false)])).toBe(true)
  })

  it('ни одного кандидата → false (безопасный дефолт для неизвестного флага)', () => {
    expect(FeatureFlag.resolve([])).toBe(false)
  })

  it('тенант БЕЗ собственной per-tenant записи использует global — АС2 DTJ-352 (findByKey(flagKey, tenantY) не нашёл строку scope=\'tenant\' для Y, кандидаты — только global)', () => {
    expect(FeatureFlag.resolve([globalFlag(true)])).toBe(true)
  })
})
