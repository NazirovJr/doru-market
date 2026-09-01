import { describe, it, expect } from 'vitest'
import { Tenant } from './tenant.entity.js'
import { TenantId } from './value-objects/tenant-id.vo.js'
import { TenantSlug } from './value-objects/tenant-slug.vo.js'
import { TenantSettings } from './tenant-settings.entity.js'
import { CourierSourcingModeVO } from './value-objects/courier-sourcing-mode.vo.js'
import { ImmutableNeutralTenantError } from './errors/immutable-neutral-tenant.error.js'
import { ValidationError } from '@dorutj/contracts'
import { CustomDomainStatusVO } from './value-objects/custom-domain-status.vo.js'

const NEUTRAL_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'
const CHAIN_TENANT_ID = '550e8400-e29b-41d4-a716-446655440001'
const NEUTRAL_SETTINGS = TenantSettings.createForProvision('DoruTJ', { '--brand-primary': '#64748b' })
// ^ Допустимо в тесте: проверяем, что `brandName` приходит в `updateBranding` —
// в DoD `DoruTJ` допустим ТОЛЬКО в seed-файле и в тестовых фикстурах.

function makeNeutral(): Tenant {
  return Tenant.create(TenantId.from(NEUTRAL_TENANT_ID), TenantSlug.parse('neutral'), {
    chainId: null,
    isNeutral: true,
    initialSettings: NEUTRAL_SETTINGS,
  })
}

function makeWhitelabel(): Tenant {
  return Tenant.create(TenantId.from(CHAIN_TENANT_ID), TenantSlug.parse('sifat-pharma'), {
    // Variant-нибл 4-й группы обязан быть `8/9/a/b` (RFC 9562) — `uuid`'s
    // `validate()` проверяет строго, `-4444-` не проходило.
    chainId: TenantId.from('11111111-2222-3333-8444-555555555555'),
    isNeutral: false,
    initialSettings: NEUTRAL_SETTINGS,
  })
}

describe('Tenant aggregate', () => {
  it('creates a neutral tenant with slug "neutral"', () => {
    const tenant = makeNeutral()
    expect(tenant.isNeutral).toBe(true)
    expect(tenant.chainId).toBeNull()
    expect(tenant.slug.value).toBe('neutral')
  })

  it('rejects neutral tenant with non-null chainId (SRS-DOM-042)', () => {
    expect(() =>
      Tenant.create(TenantId.from(NEUTRAL_TENANT_ID), TenantSlug.parse('neutral'), {
        // Variant-нибл 4-й группы обязан быть `8/9/a/b` (RFC 9562) — `uuid`'s
    // `validate()` проверяет строго, `-4444-` не проходило.
    chainId: TenantId.from('11111111-2222-3333-8444-555555555555'),
        isNeutral: true,
        initialSettings: NEUTRAL_SETTINGS,
      }),
    ).toThrow(ValidationError)
  })

  it('rejects neutral tenant with non-"neutral" slug', () => {
    expect(() =>
      Tenant.create(TenantId.from(NEUTRAL_TENANT_ID), TenantSlug.parse('public'), {
        chainId: null,
        isNeutral: true,
        initialSettings: NEUTRAL_SETTINGS,
      }),
    ).toThrow(ValidationError)
  })

  it('rejects non-neutral tenant without chainId', () => {
    expect(() =>
      Tenant.create(TenantId.from(CHAIN_TENANT_ID), TenantSlug.parse('sifat'), {
        chainId: null,
        isNeutral: false,
        initialSettings: NEUTRAL_SETTINGS,
      }),
    ).toThrow(ValidationError)
  })

  it('rename() on neutral tenant throws ImmutableNeutralTenantError', () => {
    const tenant = makeNeutral()
    expect(() => tenant.rename(TenantSlug.parse('public'))).toThrow(ImmutableNeutralTenantError)
  })

  it('attachCustomDomain on neutral tenant throws', () => {
    const tenant = makeNeutral()
    expect(() => tenant.attachCustomDomain('sifat.tj', 'token-123')).toThrow(ImmutableNeutralTenantError)
  })

  it('attachCustomDomain on whitelabel tenant normalizes domain and sets status to pending', () => {
    const tenant = makeWhitelabel()
    const updated = tenant.attachCustomDomain('  SIFAT.TJ.', 'token-abc-123')
    expect(updated.customDomain).toBe('sifat.tj')
    expect(updated.customDomainStatus.isResolvedByDomain()).toBe(false)
    expect(updated.customDomainStatus.equals(CustomDomainStatusVO.pending())).toBe(true)
    expect(updated.domainVerificationToken).toBe('token-abc-123')
  })

  it('markDomainVerified transitions pending -> verified', () => {
    const tenant = makeWhitelabel().attachCustomDomain('sifat.tj', 'token-abc')
    const verified = tenant.markDomainVerified()
    expect(verified.customDomainStatus.isResolvedByDomain()).toBe(true)
  })

  it('markDomainVerified without attached domain throws', () => {
    const tenant = makeWhitelabel()
    expect(() => tenant.markDomainVerified()).toThrow(ValidationError)
  })

  it('detachCustomDomain clears the custom_domain and status', () => {
    const tenant = makeWhitelabel().attachCustomDomain('sifat.tj', 'token').markDomainVerified()
    const detached = tenant.detachCustomDomain()
    expect(detached.customDomain).toBeNull()
    expect(detached.customDomainStatus.equals(CustomDomainStatusVO.none())).toBe(true)
  })

  it('setCourierSourcingMode returns a new tenant with updated mode', () => {
    const tenant = makeWhitelabel()
    const updated = tenant.setCourierSourcingMode(CourierSourcingModeVO.parse('own_fleet'))
    expect(updated.courierSourcingMode.value).toBe('own_fleet')
  })

  it('updateBranding returns a new tenant with new settings', () => {
    const tenant = makeWhitelabel()
    const updated = tenant.updateBranding({
      brandName: 'Sifat Updated',
      brandPalette: { '--brand-primary': '#059669' },
      brandLogoUrl: null,
    })
    expect(updated.settings.brandName).toBe('Sifat Updated')
    expect(updated.settings.brandPalette).toEqual({ '--brand-primary': '#059669' })
    // Иммутабельность (C13).
    expect(tenant.settings.brandName).toBe('DoruTJ')
  })
})
