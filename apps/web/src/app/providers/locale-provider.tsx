import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

/**
 * Провайдер локали для SRS-UX-027: переключатель языка обязан быть доступен на всех экранах без
 * авторизации. Компонент LanguageSwitcher — packages/ui (EP-18, вне зоны этого тикета), здесь
 * заводится только контекст + персистентность, чтобы packages/i18n (DTJ-004) подключился без
 * переделки шелла.
 */
export type Locale = 'tj' | 'ru' | 'en'

const DEFAULT_LOCALE: Locale = 'tj'
const LOCALE_STORAGE_KEY = 'dorutj.locale'
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
    // localStorage недоступен (приватный режим/SSR-подобное окружение) — используем дефолт молча,
    // это не блокирует смену языка в текущей сессии, только персистентность между визитами.
    return DEFAULT_LOCALE
  }
}

function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // см. комментарий в readStoredLocale — персистентность best-effort.
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
