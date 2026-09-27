// Барабанный экспорт пакета (D-27) — заглушка манифеста волны 1, наполняется тикетом DTJ-004.
export {}

export type { Locale, TranslateFunction, TranslationKey, TranslationParams } from './use-t.js'
export { useT } from './use-t.js'
export { toIntlLocale } from './intl-locale.js'

// DTJ-402 — резолвинг локали и форматирование (SRS-UX-028/031/032).
export type { ResolveLocaleInput } from './resolve-locale.js'
export { resolveLocale } from './resolve-locale.js'
export { formatMoney } from './format-money.js'
export { formatDate, formatRelativeDate, formatTime } from './format-date.js'
export type { QuantityUnit } from './format-number.js'
export { formatNumber, formatPluralized } from './format-number.js'
export { formatPhone } from './format-phone.js'
