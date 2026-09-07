import type { Locale } from './use-t.js'

/**
 * `resolveLocale` (DTJ-402 п.5, `SRS-UX-028`) — чистая функция, определяющая локаль интерфейса
 * при загрузке приложения. Приоритет ТОЧНО по спецификации (`docs/spec/30-ux-screens-and-flows.md`
 * §6, `SRS-UX-028`), от самого специфичного к самому общему:
 *
 *   1. `sessionOverride`      — явный выбор в ТЕКУЩЕЙ сессии (`LanguageSwitcher`).
 *   2. `userPreferredLocale`  — `users.preferred_locale`, если пользователь авторизован.
 *   3. `storedLocale`         — `localStorage.dorutj.locale` (гость, ранее выбирал язык).
 *   4. `tenantDefaultLocale`  — `tenants.default_locale` резолвленного тенанта. Обязательный,
 *                               последний рубеж — резолвинг тенанта уже произошёл выше по стеку
 *                               (EP-02), здесь он приходит готовым значением.
 *
 * `Accept-Language` заголовка браузера НЕТ в сигнатуре ВООБЩЕ (не просто «не используется» —
 * параметра для него не существует, поэтому использовать его здесь невозможно даже по ошибке).
 * Это намеренное продуктовое решение (D-01, research §8), не «как обычно делают i18n» — дефолт
 * платформы всегда `tj`, а не auto-detect системного языка устройства.
 */
export interface ResolveLocaleInput {
  readonly sessionOverride?: Locale
  readonly userPreferredLocale?: Locale
  readonly storedLocale?: Locale
  readonly tenantDefaultLocale: Locale
}

export function resolveLocale(input: ResolveLocaleInput): Locale {
  return (
    input.sessionOverride ?? input.userPreferredLocale ?? input.storedLocale ?? input.tenantDefaultLocale
  )
}
