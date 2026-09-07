// Барабанный экспорт пакета (D-27) — заглушка манифеста волны 1, наполняется тикетом DTJ-004.
export {}

export type { Locale, TranslateFunction, TranslationKey, TranslationParams } from './use-t.js'
export { useT } from './use-t.js'
export { toIntlLocale } from './intl-locale.js'
export { resolveLocale } from './resolve-locale.js'
export type { ResolveLocaleInput } from './resolve-locale.js'
export { formatMoney } from './format-money.js'
export { formatDate, formatRelativeDate, formatTime } from './format-date.js'
export { formatNumber, formatPluralized } from './format-number.js'
export type { CountableUnit } from './format-number.js'
export { formatPhone } from './format-phone.js'
// `I18nProvider`/`useI18nContext` НАМЕРЕННО НЕ реэкспортируются отсюда: этот файл — точка входа и
// для backend-потребителей `useT()` (`apps/api`, чей `tsconfig` не задаёт `--jsx`). Статический
// `export ... from './i18n-provider.js'` тянет `i18n-provider.tsx` в граф типов ЛЮБОГО потребителя
// барреля, включая тех, кто React вообще не подключает — эмпирически ловится `tsc --noEmit` на
// `apps/api` (TS6142 «--jsx is not set»), не рассуждением. React-компонент живёт под отдельным
// subpath-экспортом `@dorutj/i18n/provider` (см. `package.json` `exports`).
