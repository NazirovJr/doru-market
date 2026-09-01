import { describe, it, expect } from 'vitest'
import { TenantSettings } from './tenant-settings.entity.js'
import { ValidationError } from '@dorutj/contracts'

const NEUTRAL_PALETTE: Readonly<Record<string, string>> = {
  '--brand-primary': '#64748b',
}

describe('TenantSettings value entity', () => {
  it('creates with defaults via createForProvision', () => {
    const settings = TenantSettings.createForProvision('Sifat Pharma', NEUTRAL_PALETTE)
    expect(settings.brandName).toBe('Sifat Pharma')
    expect(settings.brandPalette).toEqual(NEUTRAL_PALETTE)
    expect(settings.brandLogoUrl).toBeNull()
    expect(settings.merchantCredentialsRef).toBeNull()
    expect(settings.telegramBotTokenRef).toBeNull()
    expect(settings.codLimitDiram).toBe(50000n)
    expect(settings.holdPeriodDays).toBe(1)
    expect(settings.pickupSlaMinutes).toBe(7)
    expect(settings.pickupSlaBufferMinutes).toBe(5)
    expect(settings.deliverySlaCityMinutes).toBe(240)
    expect(settings.deliverySlaRemoteMinutes).toBe(1440)
    expect(settings.disputeWindowHours).toBe(24)
    expect(settings.inventoryDeltaSlaMinutes).toBe(5)
    expect(settings.returnRestockMinRemainingDays).toBe(30)
    expect(settings.defaultLocale).toBe('tj')
  })

  it('rejects empty initialBrandName', () => {
    expect(() => TenantSettings.createForProvision('', NEUTRAL_PALETTE)).toThrow(ValidationError)
  })

  it('updateBranding returns a new instance with the new values', () => {
    const original = TenantSettings.createForProvision('Sifat', NEUTRAL_PALETTE)
    const updated = original.updateBranding({
      brandName: 'Sifat Pharma',
      brandPalette: { '--brand-primary': '#059669' },
      brandLogoUrl: 'https://cdn.example.test/logo.svg',
    })
    expect(updated.brandName).toBe('Sifat Pharma')
    expect(updated.brandPalette).toEqual({ '--brand-primary': '#059669' })
    expect(updated.brandLogoUrl).toBe('https://cdn.example.test/logo.svg')
    // Иммутабельность (C13): оригинал не изменился.
    expect(original.brandName).toBe('Sifat')
    expect(original.brandPalette).toEqual(NEUTRAL_PALETTE)
  })

  it('updateBranding rejects empty brandName', () => {
    const original = TenantSettings.createForProvision('Sifat', NEUTRAL_PALETTE)
    expect(() =>
      original.updateBranding({ brandName: '', brandPalette: NEUTRAL_PALETTE, brandLogoUrl: null }),
    ).toThrow(ValidationError)
  })

  it('restore round-trips the supplied values', () => {
    const restored = TenantSettings.restore({
      brandName: 'Restored',
      brandPalette: { '--brand-primary': '#000000' },
      brandLogoUrl: 'https://x.test/y.png',
      merchantCredentialsRef: 'vault://tenants/abc/merchant-credentials',
      telegramBotTokenRef: 'vault://tenants/abc/telegram-bot-token',
      codLimitDiram: 100000n,
      holdPeriodDays: 2,
      pickupSlaMinutes: 10,
      pickupSlaBufferMinutes: 5,
      deliverySlaCityMinutes: 240,
      deliverySlaRemoteMinutes: 1440,
      disputeWindowHours: 24,
      inventoryDeltaSlaMinutes: 5,
      returnRestockMinRemainingDays: 30,
      defaultLocale: 'ru',
    })
    expect(restored.brandName).toBe('Restored')
    expect(restored.codLimitDiram).toBe(100000n)
    expect(restored.defaultLocale).toBe('ru')
  })
})
