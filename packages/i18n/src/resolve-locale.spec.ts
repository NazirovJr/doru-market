import { describe, expect, it } from 'vitest'
import { resolveLocale, type ResolveLocaleInput } from './resolve-locale.js'

describe('resolveLocale (SRS-UX-028 приоритет резолвинга локали)', () => {
  it('session override always wins regardless of other inputs', () => {
    const result = resolveLocale({
      sessionOverride: 'en',
      userPreferredLocale: 'ru',
      storedLocale: 'tj',
      tenantDefaultLocale: 'ru',
    })

    expect(result).toBe('en')
  })

  it('authenticated user preferred_locale wins over stored/default when no session override', () => {
    const result = resolveLocale({
      userPreferredLocale: 'ru',
      storedLocale: 'en',
      tenantDefaultLocale: 'tj',
    })

    expect(result).toBe('ru')
  })

  it('guest falls back to localStorage stored locale', () => {
    const result = resolveLocale({ storedLocale: 'ru', tenantDefaultLocale: 'tj' })

    expect(result).toBe('ru')
  })

  it('falls back to tenant default locale when nothing else is set', () => {
    const result = resolveLocale({ tenantDefaultLocale: 'tj' })

    expect(result).toBe('tj')
  })

  // Компиляторная гарантия, а не рантайм-проверка: `Accept-Language` не может быть передан, потому
  // что в `ResolveLocaleInput` для него нет поля — попытка добавить его сюда провалит typecheck.
  it('never reads or is influenced by Accept-Language header (parameter does not exist in signature — compile-time guarantee, documented by test comment)', () => {
    // @ts-expect-error -- acceptLanguage не входит в ResolveLocaleInput и не должен когда-либо появиться
    const withHeader: ResolveLocaleInput = { tenantDefaultLocale: 'tj', acceptLanguage: 'ru-RU' }

    expect(resolveLocale(withHeader)).toBe('tj')
  })
})
