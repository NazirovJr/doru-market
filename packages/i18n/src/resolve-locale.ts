/**
 * `resolveLocale` (DTJ-402, `SRS-UX-028`) — чистая функция, реализующая ТОЧНЫЙ приоритет
 * резолвинга локали интерфейса при загрузке:
 *
 *   1. Явный выбор в текущей сессии (`sessionOverride`).
 *   2. Given пользователь авторизован — `users.preferred_locale` (`userPreferredLocale`).
 *   3. Given гость без сохранённого выбора — `localStorage.dorutj.locale` (`storedLocale`).
 *   4. Given ничего не найдено — `tenants.default_locale` резолвленного тенанта
 *      (`tenantDefaultLocale`, обязателен — у резолвленного тенанта дефолт есть всегда,
 *      `SRS-DOM-042`).
 *
 * `Accept-Language` заголовок браузера НЕ используется НИГДЕ в этой функции (`SRS-UX-028` п.5 —
 * явный анти-паттерн, намеренно не реализуется) — гарантия зафиксирована на уровне типа: в
 * сигнатуре `ResolveLocaleInput` попросту нет такого поля, читать его неоткуда.
 */
import type { Locale } from './use-t.js'

export interface ResolveLocaleInput {
  readonly sessionOverride?: Locale
  readonly userPreferredLocale?: Locale
  readonly storedLocale?: Locale
  readonly tenantDefaultLocale: Locale
}

export function resolveLocale(input: ResolveLocaleInput): Locale {
  if (input.sessionOverride !== undefined) {
    return input.sessionOverride
  }

  if (input.userPreferredLocale !== undefined) {
    return input.userPreferredLocale
  }

  if (input.storedLocale !== undefined) {
    return input.storedLocale
  }

  return input.tenantDefaultLocale
}
