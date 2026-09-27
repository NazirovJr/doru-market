import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { Locale } from '@dorutj/i18n'

/**
 * `LocaleProvider` (DTJ-433) — портировано из `apps/web/src/shared/config/locale-provider.tsx`
 * (DTJ-003/402, SRS-UX-027): та же схема резолвинга/персистентности, свой ключ `localStorage`
 * (`dorutj.pharmacy.locale`, не `dorutj.locale` — тот же приём разделения неймспейсов, что
 * `shared/api/auth-store.ts`).
 */
const DEFAULT_LOCALE: Locale = 'tj'
const LOCALE_STORAGE_KEY = 'dorutj.pharmacy.locale'
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
    // localStorage недоступен (приватный режим) — дефолт молча, не блокирует смену в сессии.
    return DEFAULT_LOCALE
  }
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // см. readStoredLocale — персистентность best-effort.
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

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (context === undefined) {
    throw new Error('useLocale должен использоваться внутри LocaleProvider')
  }
  return context
}
