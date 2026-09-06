/**
 * Резолв локали по `Accept-Language` (EP-05, DTJ-163/164) — тот же приём, что
 * `CatalogSearchController.resolveLocale`/`AnalogsController.resolveLocale` (DTJ-190):
 * первый языковой тег заголовка, приведённый к одному из трёх поддерживаемых кодов,
 * иначе — дефолт платформы `tj` (SRS-UX-027).
 */
import type { Locale } from '@dorutj/i18n'

const SUPPORTED_LOCALES: readonly Locale[] = ['tj', 'ru', 'en']
const DEFAULT_LOCALE: Locale = 'tj'

export function resolveLocale(acceptLanguage: string | undefined): Locale {
  if (acceptLanguage === undefined || acceptLanguage.length === 0) {
    return DEFAULT_LOCALE
  }
  const primaryTag = (acceptLanguage.split(',')[0] ?? '').split(';')[0]?.split('-')[0]?.trim().toLowerCase()
  if (primaryTag !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(primaryTag)) {
    return primaryTag as Locale
  }
  return DEFAULT_LOCALE
}
