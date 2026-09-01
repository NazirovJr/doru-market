import { Outlet } from 'react-router'
import type { ReactElement } from 'react'
import { useLocale, type Locale } from '@/shared/config/locale-provider'

// Плейсхолдеры до готовности packages/ui (EP-18): BrandLogo и LanguageSwitcher — реальные
// компоненты подключит соответствующий тикет EP-18, здесь только зарезервировано место в layout
// (SRS-UX-027 требует переключатель языка на всех неавторизованных экранах).
// TODO(EP-18): заменить [ Бренд ] на packages/ui BrandLogo.
const BRAND_PLACEHOLDER = '[ Бренд ]'

const LOCALE_LABELS: Readonly<Record<Locale, string>> = { tj: 'TJ', ru: 'RU', en: 'EN' }
const LOCALE_CODES = Object.keys(LOCALE_LABELS) as readonly Locale[]

const LanguageSwitcherPlaceholder = (): ReactElement => {
  const { locale, setLocale } = useLocale()
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="language-switcher-placeholder">
      {LOCALE_CODES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => {
            setLocale(code)
          }}
          aria-pressed={locale === code}
          className={locale === code ? 'font-semibold text-ink' : 'text-ink-muted'}
        >
          {LOCALE_LABELS[code]}
        </button>
      ))}
    </div>
  )
}

export const AppLayout = (): ReactElement => (
  <div className="flex min-h-screen flex-col bg-surface text-ink">
    <header className="flex items-center justify-between border-b border-line px-4 py-3">
      <span className="font-semibold" data-testid="brand-placeholder">
        {BRAND_PLACEHOLDER}
      </span>
      <LanguageSwitcherPlaceholder />
    </header>
    <main className="flex-1 p-4">
      <Outlet />
    </main>
  </div>
)
