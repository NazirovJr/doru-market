import { describe, expect, expectTypeOf, it } from 'vitest'
import { resolveLocale, type ResolveLocaleInput } from './resolve-locale.js'

describe('resolveLocale (SRS-UX-028)', () => {
  it('session override always wins regardless of other inputs', () => {
    const result = resolveLocale({
      sessionOverride: 'en',
      userPreferredLocale: 'ru',
      storedLocale: 'ru',
      tenantDefaultLocale: 'tj',
    })

    expect(result).toBe('en')
  })

  it('authenticated user preferred_locale wins over stored/default when no session override', () => {
    const result = resolveLocale({
      userPreferredLocale: 'en',
      storedLocale: 'ru',
      tenantDefaultLocale: 'tj',
    })

    expect(result).toBe('en')
  })

  it('guest falls back to localStorage stored locale (no session override, no profile)', () => {
    const result = resolveLocale({ storedLocale: 'ru', tenantDefaultLocale: 'tj' })

    expect(result).toBe('ru')
  })

  it('falls back to tenant default locale when nothing else is set', () => {
    const result = resolveLocale({ tenantDefaultLocale: 'tj' })

    expect(result).toBe('tj')
  })

  it('never reads or is influenced by Accept-Language header — the parameter does not exist in the signature', () => {
    // Компиляторная гарантия, не рантайм-проверка (`SRS-UX-028` п.5): `ResolveLocaleInput` не
    // содержит поля для заголовка `Accept-Language` в принципе, поэтому его физически неоткуда
    // прочитать внутри `resolveLocale`. Ниже — явная проверка формы типа: единственные ключи
    // входа перечислены и не включают ничего браузерного/HTTP-заголовочного.
    expectTypeOf<keyof ResolveLocaleInput>().toEqualTypeOf<
      'sessionOverride' | 'userPreferredLocale' | 'storedLocale' | 'tenantDefaultLocale'
    >()

    const withAcceptLanguage: ResolveLocaleInput = {
      tenantDefaultLocale: 'tj',
      // @ts-expect-error — поле `acceptLanguage`/`Accept-Language` не существует в типе входа.
      acceptLanguage: 'ru-RU',
    }
    expect(resolveLocale(withAcceptLanguage)).toBe('tj')
  })
})
