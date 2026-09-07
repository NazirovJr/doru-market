import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND_FONT_FAMILY_ALLOWLIST, validateBrandingPayload } from './branding-allowlist.js'

/**
 * Пейлоады читаются рантайм-чтением файла, а не статическим `import ... from '*.json'`, потому
 * что `tsconfig.json` (barrel, не в files_owned этого тикета) не включает `**\/*.json` в `include`
 * — статический импорт JSON падает на `tsc --noEmit` с TS6307. `readFileSync` не требует
 * присутствия файла в списке проекта TypeScript.
 */
const fixturePath = join(import.meta.dirname, 'tests', 'fixtures', 'branding-injection-payloads.json')
const injectionFixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { payloads: readonly string[] }

describe('validateBrandingPayload', () => {
  it('accepts valid 6-digit and 3-digit hex colors', () => {
    const result = validateBrandingPayload({ primary: '#111827', accent: '#0ea' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.primary).toBe('#111827')
      expect(result.value.accent).toBe('#0ea')
    }
  })

  it('normalizes accepted hex values (AC1: given { primary: "#111827" })', () => {
    const result = validateBrandingPayload({ primary: '#111827' })
    expect(result).toEqual({ ok: true, value: { primary: '#111827' } })
  })

  it('rejects non-hex color values (url/javascript/script injection payloads, TC-NFR-006)', () => {
    for (const payload of injectionFixture.payloads) {
      const result = validateBrandingPayload({ primary: payload })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors).toEqual([{ field: 'primary', code: 'INVALID_HEX_FORMAT' }])
        expect(result.value).not.toHaveProperty('primary')
      }
    }
  })

  it('AC2: rejects "url(javascript:alert(1))" with INVALID_HEX_FORMAT, value not passed through', () => {
    const result = validateBrandingPayload({ primary: 'url(javascript:alert(1))' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: 'primary', code: 'INVALID_HEX_FORMAT' }])
      expect(result.value).toStrictEqual({})
    }
  })

  it('rejects semantic token override (success/danger/warning) with BRAND_SEMANTIC_TOKEN_LOCKED', () => {
    const result = validateBrandingPayload({ success: '#000000', danger: '#111111', warning: '#222222' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([
        { field: 'success', code: 'BRAND_SEMANTIC_TOKEN_LOCKED' },
        { field: 'danger', code: 'BRAND_SEMANTIC_TOKEN_LOCKED' },
        { field: 'warning', code: 'BRAND_SEMANTIC_TOKEN_LOCKED' },
      ])
    }
  })

  it('AC3: locked field error does not drop other valid fields from the result', () => {
    const result = validateBrandingPayload({ success: '#000000', primary: '#111827' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: 'success', code: 'BRAND_SEMANTIC_TOKEN_LOCKED' }])
      expect(result.value).toEqual({ primary: '#111827' })
    }
  })

  it('accepts radius matching ^\\d{1,2}px$, rejects otherwise', () => {
    expect(validateBrandingPayload({ radius: '8px' })).toEqual({ ok: true, value: { radius: '8px' } })
    expect(validateBrandingPayload({ radius: '12px' })).toEqual({ ok: true, value: { radius: '12px' } })

    for (const invalidRadius of ['8', '100px', '-4px']) {
      const result = validateBrandingPayload({ radius: invalidRadius })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors).toEqual([{ field: 'radius', code: 'INVALID_RADIUS_FORMAT' }])
      }
    }
  })

  it('accepts fontFamily from allowlist, rejects arbitrary font stack', () => {
    const allowed = BRAND_FONT_FAMILY_ALLOWLIST[0]!
    expect(validateBrandingPayload({ fontFamily: allowed })).toEqual({ ok: true, value: { fontFamily: allowed } })

    const result = validateBrandingPayload({ fontFamily: "'Comic Sans MS', cursive" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: 'fontFamily', code: 'INVALID_FONT_FAMILY' }])
    }
  })

  it('partial validation: one invalid field does not drop other valid fields from the result', () => {
    const result = validateBrandingPayload({
      primary: '#111827',
      secondary: 'not-a-color',
      radius: '12px',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: 'secondary', code: 'INVALID_HEX_FORMAT' }])
      expect(result.value).toEqual({ primary: '#111827', radius: '12px' })
    }
  })

  it('accepts an empty payload with no fields to validate', () => {
    expect(validateBrandingPayload({})).toEqual({ ok: true, value: {} })
  })

  it('collects errors for multiple simultaneously invalid fields, not just the first', () => {
    const result = validateBrandingPayload({
      primary: 'not-a-color',
      radius: '100px',
      fontFamily: 'Arial',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([
        { field: 'primary', code: 'INVALID_HEX_FORMAT' },
        { field: 'radius', code: 'INVALID_RADIUS_FORMAT' },
        { field: 'fontFamily', code: 'INVALID_FONT_FAMILY' },
      ])
    }
  })
})
