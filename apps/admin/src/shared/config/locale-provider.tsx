import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { Locale } from '@dorutj/i18n'

// По образцу apps/pharmacy/src/shared/config/locale-provider.tsx (DTJ-433); свой ключ localStorage.
const DEFAULT_LOCALE: Locale = 'tj'
const LOCALE_STORAGE_KEY = 'dorutj.admin.locale'
const SUPPORTED_LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

interface LocaleContextValue {
  readonly locale: Locale
  readonly setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined)

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return stored !== null && isLocale(stored) ? stored : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // best-effort
  }
}

interface LocaleProviderProps {
  readonly children: ReactNode
}

export const LocaleProvider = ({ children }: LocaleProviderProps): ReactElement => {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale)

  const setLocale = useCallback((next: Locale): void => {
    setLocaleState(next)
    persistLocale(next)
  }, [])

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale }), [locale, setLocale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

// Фолбэк вместо throw (в отличие от apps/pharmacy): десятки уже сданных экранов apps/admin
// (не files_owned этого тикета) рендерятся в тестах без обёртки — узкая замена useT('ru'/'tj')
// на этот хук не должна требовать правки их спеков. 'ru' — бывший ADMIN_LOCALE, локаль тех спеков.
function noop(): void {
  // без Provider смена локали некуда сохранять — намеренная заглушка
}
const FALLBACK_LOCALE_VALUE: LocaleContextValue = { locale: 'ru', setLocale: noop }

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext) ?? FALLBACK_LOCALE_VALUE
}
