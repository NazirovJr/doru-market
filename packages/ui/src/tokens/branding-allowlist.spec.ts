import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BRAND_COLOR_KEYS,
  BRAND_FONT_FAMILY_ALLOWLIST,
  validateBrandingPayload,
} from './branding-allowlist'

/**
 * Пейлоады CSS/HTML-инъекции через палитру (TC-NFR-006 / TC-TEN-008). ЕДИНСТВЕННЫЙ источник —
 * `tests/security/payloads/branding-injection.json` (DTJ-425, DoD «пейлоады синхронизированы,
 * не дублируются независимым списком») — читается отсюда, а не хардкодится второй раз здесь.
 */
const INJECTION_PAYLOADS = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../tests/security/payloads/branding-injection.json'), 'utf8'),
) as readonly string[]

describe('validateBrandingPayload', () => {
  it('AC1: accepts a valid color and returns normalized value', () => {
    expect(validateBrandingPayload({ primary: '#111827' })).toEqual({
      ok: true,
      value: { primary: '#111827' },
    })
  })

  it('accepts valid 6-digit and 3-digit hex colors', () => {
    const result = validateBrandingPayload({
      primary: '#ABCDEF',
      primaryHover: '#1a2B3c',
      secondary: '#FfF',
      accent: '#0a9',
    })
    expect(result).toEqual({
      ok: true,
      value: { primary: '#abcdef', primaryHover: '#1a2b3c', secondary: '#ffffff', accent: '#00aa99' },
    })
  })

  it('accepts every editable color key', () => {
    const payload = Object.fromEntries(BRAND_COLOR_KEYS.map((key) => [key, '#123456']))
    const result = validateBrandingPayload(payload)
    expect(result.ok).toBe(true)
    expect(Object.keys(result.value).sort()).toEqual([...BRAND_COLOR_KEYS].sort())
  })

  it('AC2: rejects url(javascript:...) and does not pass the value through', () => {
    const result = validateBrandingPayload({ primary: 'url(javascript:alert(1))' })
    expect(result).toEqual({
      ok: false,
      value: {},
      errors: [{ field: 'primary', code: 'INVALID_HEX_FORMAT' }],
    })
    expect(JSON.stringify(result)).not.toContain('javascript')
  })

  it.each(INJECTION_PAYLOADS)(
    'rejects non-hex color value (url/javascript/script injection payloads): %j',
    (payload) => {
      const result = validateBrandingPayload({ accent: payload })
      expect(result.ok).toBe(false)
      expect(result.value).toEqual({})
      if (!result.ok) expect(result.errors).toEqual([{ field: 'accent', code: 'INVALID_HEX_FORMAT' }])
    },
  )

  it.each([123456, null, undefined, true, { hex: '#ffffff' }, ['#ffffff']])(
    'rejects non-string color value %j',
    (raw) => {
      const result = validateBrandingPayload({ border: raw })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors).toEqual([{ field: 'border', code: 'INVALID_HEX_FORMAT' }])
    },
  )

  it.each(['success', 'danger', 'warning'])(
    'AC3: rejects semantic token override (%s) with BRAND_SEMANTIC_TOKEN_LOCKED even for a valid hex',
    (key) => {
      const result = validateBrandingPayload({ [key]: '#000000', primary: '#111827' })
      expect(result).toEqual({
        ok: false,
        value: { primary: '#111827' },
        errors: [{ field: key, code: 'BRAND_SEMANTIC_TOKEN_LOCKED' }],
      })
    },
  )

  it.each(['0px', '8px', '12px', '99px'])('accepts radius %j matching ^\\d{1,2}px$', (radius) => {
    expect(validateBrandingPayload({ radius })).toEqual({ ok: true, value: { radius } })
  })

  it.each(['8', '100px', '-4px', '8.5px', '8em', '8 px', '8px;', 'calc(8px * 2)', '', 8])(
    'rejects radius %j',
    (radius) => {
      const result = validateBrandingPayload({ radius })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors).toEqual([{ field: 'radius', code: 'INVALID_RADIUS_FORMAT' }])
    },
  )

  it.each(BRAND_FONT_FAMILY_ALLOWLIST)('accepts fontFamily from allowlist: %j', (fontFamily) => {
    expect(validateBrandingPayload({ fontFamily })).toEqual({ ok: true, value: { fontFamily } })
  })

  it.each([
    'MyCustomHackerFont, sans-serif',
    "'Inter', system-ui, sans-serif; } body { display:none",
    "'inter', system-ui, sans-serif",
    'Inter',
    "url(https://evil.example/font.woff2), 'Inter'",
    '',
    null,
  ])('rejects arbitrary font stack %j', (fontFamily) => {
    const result = validateBrandingPayload({ fontFamily })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toEqual([{ field: 'fontFamily', code: 'FONT_FAMILY_NOT_ALLOWED' }])
    }
  })

  it('font allowlist holds at most 10 Google Fonts stacks plus the system fallback', () => {
    expect(BRAND_FONT_FAMILY_ALLOWLIST).toContain('system-ui, sans-serif')
    expect(BRAND_FONT_FAMILY_ALLOWLIST.length).toBeLessThanOrEqual(11)
  })

  it.each(['--brand-primary', 'radiusFull', 'background', '__proto__', 'constructor'])(
    'rejects unknown token %j and never copies it into the result',
    (key) => {
      const payload = JSON.parse(`{"${key}":"#ffffff"}`) as Record<string, unknown>
      const result = validateBrandingPayload(payload)
      expect(result.ok).toBe(false)
      expect(Object.keys(result.value)).toEqual([])
      if (!result.ok) expect(result.errors).toEqual([{ field: key, code: 'UNKNOWN_BRAND_TOKEN' }])
    },
  )

  it('partial validation: one invalid field does not drop other valid fields from the result', () => {
    const result = validateBrandingPayload({
      primary: '#059669',
      accent: '</style><script>alert(1)</script>',
      radius: '12px',
      fontFamily: "'Inter', system-ui, sans-serif",
      warning: '#00ff00',
    })
    expect(result).toEqual({
      ok: false,
      value: { primary: '#059669', radius: '12px', fontFamily: "'Inter', system-ui, sans-serif" },
      errors: [
        { field: 'accent', code: 'INVALID_HEX_FORMAT' },
        { field: 'warning', code: 'BRAND_SEMANTIC_TOKEN_LOCKED' },
      ],
    })
  })

  it('accepts an empty payload (nothing to change)', () => {
    expect(validateBrandingPayload({})).toEqual({ ok: true, value: {} })
  })
})

/**
 * Инварианты CSS-токенов (AC4, DoD «--focus-ring от --brand-primary»). Живут здесь, потому что
 * files_owned тикета DTJ-401 содержит единственный spec-файл.
 *
 * jsdom не каскадирует custom properties из `<style>` в `getComputedStyle` (видит только inline
 * `style`). Поэтому `rootVar` воспроизводит вычисленное значение custom property по CSS-спеке:
 * inline-стиль `:root` (так тенант применяет палитру на рантайме, SRS-TEN-015) → последнее
 * объявление в правилах `:root` из CSSOM → рекурсивная подстановка `var()`.
 */
describe('design tokens CSS', () => {
  const readToken = (file: string): string => readFileSync(join(import.meta.dirname, file), 'utf8')
  const mounted: HTMLStyleElement[] = []

  const mountCss = (css: string): void => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    mounted.push(style)
  }

  const declaredRootVar = (name: string): string => {
    const inline = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (inline !== '') return inline
    const rootRules = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ':root')
    const declared = rootRules.map((rule) => rule.style.getPropertyValue(name).trim()).filter(Boolean)
    return declared.at(-1) ?? ''
  }

  const rootVar = (name: string): string =>
    declaredRootVar(name).replace(/var\((--[\w-]+)\)/g, (_match, ref: string) => rootVar(ref))

  afterEach(() => {
    mounted.splice(0).forEach((style) => {
      style.remove()
    })
    document.documentElement.removeAttribute('style')
  })

  it('AC4: --radius-full stays 999px when --brand-radius is overridden to 0px', () => {
    mountCss(readToken('radii.css'))
    expect(rootVar('--radius-md')).toBe('calc(8px*1.5)')

    document.documentElement.style.setProperty('--brand-radius', '0px')

    expect(rootVar('--brand-radius')).toBe('0px')
    expect(rootVar('--radius-sm')).toBe('0px')
    expect(rootVar('--radius-lg')).toBe('calc(0px*2)')
    expect(rootVar('--radius-full')).toBe('999px')
  })

  it('AC4: a stylesheet override of --brand-radius does not touch --radius-full either', () => {
    mountCss(readToken('radii.css'))
    mountCss(':root { --brand-radius: 0px; }')
    expect(rootVar('--radius-sm')).toBe('0px')
    expect(rootVar('--radius-full')).toBe('999px')
  })

  it('radii formula yields the fixed 8 / 12 / 16 / 999 set [D-26]', () => {
    const css = readToken('radii.css')
    expect(css).toMatch(/--brand-radius:\s*8px;/)
    expect(css).toMatch(/--radius-sm:\s*var\(--brand-radius\);/)
    expect(css).toMatch(/--radius-md:\s*calc\(var\(--brand-radius\) \* 1\.5\);/)
    expect(css).toMatch(/--radius-lg:\s*calc\(var\(--brand-radius\) \* 2\);/)
    expect(css).toMatch(/--radius-full:\s*999px;/)
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).not.toMatch(/\b(10|14)px/)
  })

  it('--focus-ring derives from --brand-primary, not --brand-accent [D-26]', () => {
    mountCss(readToken('colors.css'))
    mountCss(readToken('shadows.css'))
    expect(declaredRootVar('--focus-ring')).toContain('var(--brand-primary)')
    expect(declaredRootVar('--focus-ring')).not.toContain('--brand-accent')

    document.documentElement.style.setProperty('--brand-primary', '#059669')
    expect(rootVar('--focus-ring')).toContain('color-mix(in srgb,#059669 40%,transparent)')
  })

  it('--shadow-modal uses alpha 0.08 [D-26]', () => {
    mountCss(readToken('shadows.css'))
    expect(rootVar('--shadow-modal')).toMatch(/0\.08\)$/)
  })

  it('typography scale includes [D-26] h1/h2 and semibold', () => {
    mountCss(readToken('typography.css'))
    expect(rootVar('--font-size-h2')).toBe('22px')
    expect(rootVar('--font-size-h1')).toBe('28px')
    expect(rootVar('--font-weight-semibold')).toBe('600')
    // CSSOM сериализует кавычки/пробелы font-family иначе, чем литерал в исходном CSS
    // ('Inter', system-ui → "Inter",system-ui) — сравнение нормализует оба представления,
    // не ослабляя сам allowlist в branding-allowlist.ts.
    const normalizeFontStack = (stack: string): string =>
      stack.replace(/'/g, '"').replace(/,\s*/g, ',')
    expect(BRAND_FONT_FAMILY_ALLOWLIST.map(normalizeFontStack)).toContain(
      normalizeFontStack(rootVar('--brand-font-family')),
    )
  })

  it('colors expose neutral defaults, locked semantics and [D-26] warning tokens', () => {
    mountCss(readToken('colors.css'))
    expect(rootVar('--brand-primary')).toBe('#64748b')
    expect(rootVar('--brand-success')).toBe('#16a34a')
    expect(rootVar('--brand-danger')).toBe('#dc2626')
    expect(rootVar('--brand-warning')).toBe('#d97706')
    expect(rootVar('--brand-warning-fg')).toBe('#b45309')
    expect(rootVar('--brand-warning-strong')).toBe('#92400e')
  })

  it('spacing scale is 4px-based', () => {
    mountCss(readToken('spacing.css'))
    expect(rootVar('--space-1')).toBe('4px')
    expect(rootVar('--space-16')).toBe('64px')
  })
})
