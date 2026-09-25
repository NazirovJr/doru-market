/**
 * `useT` — минимальный файловый хук i18n (DTJ-004, `SRS-UX-023`/`SRS-UX-027`).
 * ВРЕМЕННО: словари статически импортируются из JSON, пока не появится серверная раздача
 * `GET /api/v1/i18n/:locale` (`SRS-API-058`, зона EP-18) — `apps/web` переключится на неё позже.
 * Не проектировать этот API как окончательный (см. «Риски» тикета DTJ-004) — EP-18 может
 * переписать реализацию, сохранив контракт `useT(locale) -> { t }`.
 */
import en from './dictionaries/en.json' with { type: 'json' }
import ru from './dictionaries/ru.json' with { type: 'json' }
import tj from './dictionaries/tj.json' with { type: 'json' }

/** Три поддерживаемые локали (`SRS-UX-027`): `tj` — дефолт платформы. */
export type Locale = 'tj' | 'ru' | 'en'

type Dictionary = Readonly<Record<string, string>>

export type TranslationParams = Readonly<Record<string, string | number>>

export type TranslateFunction = (key: string, params?: TranslationParams) => string

/** Плейсхолдер вида `{param}` в строке словаря — синтаксис зафиксирован тикетом DTJ-004 п.3. */
const PARAM_PATTERN = /\{(\w+)\}/g

const MISSING_KEY_PREFIX = '[[missing: '
const MISSING_KEY_SUFFIX = ']]'

/** Локаль последнего резерва для прод-фолбэка отсутствующего ключа (DTJ-004 п.3). */
const FALLBACK_LOCALE: Locale = 'en'

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { tj, ru, en }

/**
 * `TranslationKey` (DTJ-402) — объединение всех ключей `ru`-словаря (три словаря — паритетны по
 * ключам, тест `dictionary key parity` в `use-t.spec.ts` это гарантирует). Даёт TS-ошибку при
 * опечатке в ключе НОВОМУ коду, который явно типизирует свой вызов этим типом.
 *
 * ВАЖНО (обратная совместимость, зафиксировано условиями тикета DTJ-402): сигнатура
 * `TranslateFunction`/`useT` ниже сознательно НЕ сужена до `(key: TranslationKey, …)` — десятки
 * существующих мест в `apps/web`/`apps/admin`/`apps/pharmacy` вызывают `t(key)` с `key`,
 * вычисленным как обычный `string` (через маппинги `Record<string, TranslationKey-подобное>`,
 * тернарники, `mapping.key` и т.п. — см. компоненты `apps/web`/`apps/admin`/`apps/pharmacy`), и были обязаны компилироваться
 * и проходить тесты без правок. Сужение сигнатуры сломало бы эти вызовы. `TranslationKey`
 * экспортируется как typed-safe тип для НОВОГО кода (DTJ-404+), который может явно типизировать
 * свои собственные ключи/пропсы этим типом (см. `format.spec.ts` — тест типов демонстрирует
 * отказ компиляции для несуществующего литерала ключа, приёмочный критерий 5 DTJ-402).
 */
export type TranslationKey = keyof typeof ru

function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function interpolate(template: string, params?: TranslationParams): string {
  if (params === undefined) {
    return template
  }

  return template.replace(PARAM_PATTERN, (placeholder: string, paramName: string): string => {
    const value = params[paramName]
    return value === undefined ? placeholder : String(value)
  })
}

function buildMissingKeyMarker(key: string): string {
  return `${MISSING_KEY_PREFIX}${key}${MISSING_KEY_SUFFIX}`
}

/**
 * Прод-ветка отсутствующего ключа: фолбэк на `en`-словарь с заметным предупреждением в лог.
 * Тихий фолбэк запрещён тикетом DTJ-004 п.3 — пропуск ключа обязан быть виден в мониторинге.
 */
function resolveMissingKeyInProduction(key: string, locale: Locale): string {
  const fallbackValue = DICTIONARIES[FALLBACK_LOCALE][key]
  // eslint-disable-next-line no-console -- намеренный прод-фолбэк по ТЗ DTJ-004 п.3: отсутствующий ключ обязан быть виден в логе; у клиентского пакета нет доступа к pino.
  console.warn(
    `[@dorutj/i18n] missing translation key "${key}" for locale "${locale}", falling back to "${FALLBACK_LOCALE}"`,
  )

  return fallbackValue ?? buildMissingKeyMarker(key)
}

function resolveTemplate(key: string, locale: Locale): string {
  return isDevelopmentEnvironment() ? buildMissingKeyMarker(key) : resolveMissingKeyInProduction(key, locale)
}

function translate(locale: Locale, key: string, params?: TranslationParams): string {
  const template = DICTIONARIES[locale][key] ?? resolveTemplate(key, locale)
  return interpolate(template, params)
}

/**
 * Given `locale`, возвращает функцию `t(key, params?)`, разрешающую ключ словаря выбранной
 * локали с интерполяцией `{param}`. Отсутствующий ключ — см. `resolveTemplate`.
 */
export function useT(locale: Locale): { t: TranslateFunction } {
  const t: TranslateFunction = (key, params) => translate(locale, key, params)
  return { t }
}
