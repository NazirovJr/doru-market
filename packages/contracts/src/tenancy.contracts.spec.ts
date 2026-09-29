import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BRAND_FONT_FAMILY_ALLOWLIST,
  BrandPaletteSchema,
  NEUTRAL_FALLBACK_PALETTE,
  pickEditableBrandTokens,
  UpdateBrandingRequestSchema,
} from './tenancy.js'

const INJECTION_PAYLOADS = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../tests/security/payloads/branding-injection.json'), 'utf8'),
) as readonly string[]

const COLOR_TOKENS = Object.keys(NEUTRAL_FALLBACK_PALETTE).filter((key) => !['--brand-radius', '--brand-font-family'].includes(key))

describe('BrandPaletteSchema', () => {
  it('принимает нейтральную палитру целиком', () => {
    expect(BrandPaletteSchema.safeParse(NEUTRAL_FALLBACK_PALETTE).success).toBe(true)
  })

  it('partial() принимает подмножество токенов и пустой объект', () => {
    expect(BrandPaletteSchema.partial().safeParse({ '--brand-primary': '#0f766e' }).success).toBe(true)
    expect(BrandPaletteSchema.partial().safeParse({}).success).toBe(true)
  })

  it.each(COLOR_TOKENS)('%s: любой инъекционный пейлоад отклоняется', (token) => {
    for (const payload of INJECTION_PAYLOADS) {
      const result = BrandPaletteSchema.partial().safeParse({ [token]: payload })
      expect(result.success, `${token} = ${JSON.stringify(payload)}`).toBe(false)
    }
  })

  it('отклоняет 3-значный HEX и rgba()', () => {
    expect(BrandPaletteSchema.partial().safeParse({ '--brand-primary': '#fff' }).success).toBe(false)
    expect(BrandPaletteSchema.partial().safeParse({ '--brand-primary': 'rgba(0,0,0,1)' }).success).toBe(false)
  })

  it.each(['8', '8px;', 'calc(1px)', '100px', '-1px', 'url(x)'])('--brand-radius: %j отклоняется', (radius) => {
    expect(BrandPaletteSchema.partial().safeParse({ '--brand-radius': radius }).success).toBe(false)
  })

  it('--brand-radius: 12px принимается', () => {
    expect(BrandPaletteSchema.partial().safeParse({ '--brand-radius': '12px' }).success).toBe(true)
  })

  it.each(['MyCustomHackerFont, sans-serif', "system-ui, sans-serif; } body { display:none", ''])(
    '--brand-font-family вне allowlist: %j отклоняется',
    (font) => {
      expect(BrandPaletteSchema.partial().safeParse({ '--brand-font-family': font }).success).toBe(false)
    },
  )

  it.each(BRAND_FONT_FAMILY_ALLOWLIST)('--brand-font-family из allowlist принимается: %s', (font) => {
    expect(BrandPaletteSchema.partial().safeParse({ '--brand-font-family': font }).success).toBe(true)
  })

  it.each(['background', '--evil', '--brand-primary-x'])('неизвестный ключ %j отклоняется, не игнорируется', (key) => {
    const result = BrandPaletteSchema.partial().safeParse({ [key]: '#000000' })
    expect(result.success).toBe(false)
  })

  it('__proto__ из JSON не попадает в результат парсинга', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"x":"#000000"},"--brand-primary":"#000000"}')
    const result = BrandPaletteSchema.partial().safeParse(parsed)
    expect(result.success && Object.keys(result.data)).toEqual(['--brand-primary'])
  })
})

describe('UpdateBrandingRequestSchema', () => {
  const valid = { brandName: 'Sifat', brandPalette: { '--brand-primary': '#0f766e' } }

  it('валидный запрос; logoUrl необязателен', () => {
    expect(UpdateBrandingRequestSchema.safeParse(valid).success).toBe(true)
    expect(UpdateBrandingRequestSchema.safeParse({ ...valid, logoUrl: 'https://cdn.example.com/logo.png' }).success).toBe(true)
    expect(UpdateBrandingRequestSchema.safeParse({ ...valid, logoUrl: null }).success).toBe(true)
  })

  it('пустое brandName и лишние поля отклоняются', () => {
    expect(UpdateBrandingRequestSchema.safeParse({ ...valid, brandName: '   ' }).success).toBe(false)
    expect(UpdateBrandingRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
    expect(UpdateBrandingRequestSchema.safeParse({ ...valid, brandName: 'x'.repeat(256) }).success).toBe(false)
  })

  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'not a url'])('logoUrl %j отклоняется', (logoUrl) => {
    expect(UpdateBrandingRequestSchema.safeParse({ ...valid, logoUrl }).success).toBe(false)
  })
})

describe('семантические цвета не перекрашиваются тенантом', () => {
  it.each(['--brand-success', '--brand-danger', '--brand-warning', '--brand-danger-bg', '--brand-success-text', '--brand-warning-strong'])(
    '%s отклоняется как неизвестный токен',
    (token) => {
      const result = BrandPaletteSchema.partial().safeParse({ [token]: '#123456' })
      expect(result.success).toBe(false)
      expect(!result.success && result.error.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: [token] })
    },
  )

  it('NEUTRAL_FALLBACK_PALETTE их не содержит', () => {
    expect(Object.keys(NEUTRAL_FALLBACK_PALETTE).filter((key) => /success|danger|warning/u.test(key))).toEqual([])
  })

  it('pickEditableBrandTokens отбрасывает устаревшие семантические ключи', () => {
    expect(pickEditableBrandTokens({ '--brand-primary': '#0f766e', '--brand-danger': '#dc2626' })).toEqual({ '--brand-primary': '#0f766e' })
  })
})
