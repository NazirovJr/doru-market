import { createContext, useContext, useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import { toIntlLocale } from './intl-locale.js'
import { useT, type Locale, type TranslateFunction } from './use-t.js'

/**
 * `I18nProvider` (DTJ-402 п.10) — тонкая обвязка (`app`-слой, `02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §5), без бизнес-логики: держит `locale` в контексте и синхронизирует `<html dir>`/`<html lang>`
 * с ним при монтировании/смене локали. Управление САМИМ значением `locale` (резолвинг, смена по
 * клику в `LanguageSwitcher`, персистентность в `localStorage`/профиле) — вне этого компонента,
 * это ответственность вызывающего приложения (`resolveLocale`, п.5 этого же тикета) — провайдер
 * только потребляет уже резолвленное значение.
 *
 * `dir="ltr"` — ФИКСИРОВАННОЕ значение (`SRS-UX-033`): все три локали (`tj`/`ru`/`en`) читаются
 * слева направо, RTL не поддерживается и не является открытым вопросом. `spellcheck`/`autocorrect`
 * здесь НЕ включаются и не выключаются ни для одного поля — это обязанность конкретного поля ввода
 * (например `SearchBar`, DTJ-408), провайдер этому просто не мешает.
 */
export interface I18nContextValue {
  readonly locale: Locale
  readonly t: TranslateFunction
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

const FIXED_TEXT_DIRECTION = 'ltr'

export interface I18nProviderProps {
  readonly locale: Locale
  readonly children: ReactNode
}

export const I18nProvider = ({ locale, children }: I18nProviderProps): ReactElement => {
  useEffect(() => {
    document.documentElement.dir = FIXED_TEXT_DIRECTION
    document.documentElement.lang = toIntlLocale(locale)
  }, [locale])

  const value = useMemo<I18nContextValue>(() => ({ locale, t: useT(locale).t }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Доступ к `{ locale, t }` из контекста `I18nProvider` — альтернатива прокидыванию `t` пропсами. */
export function useI18nContext(): I18nContextValue {
  const context = useContext(I18nContext)
  if (context === undefined) {
    throw new Error('useI18nContext должен использоваться внутри I18nProvider')
  }
  return context
}
