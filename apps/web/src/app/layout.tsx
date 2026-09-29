import { Outlet } from 'react-router'
import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { TenantBrandLogo, useTenantBranding } from '@dorutj/ui'
import { useLocale, type Locale } from '@/shared/config/locale-provider'

const LOCALE_LABELS: Readonly<Record<Locale, string>> = { tj: 'TJ', ru: 'RU', en: 'EN' }
const LOCALE_CODES = Object.keys(LOCALE_LABELS) as readonly Locale[]

// Плейсхолдер: LanguageSwitcher из packages/ui сюда пока не подключён.
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

export const AppLayout = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const brandName = useTenantBranding()?.brandName ?? t('brand.name')
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 font-semibold">
          <TenantBrandLogo fallbackName={t('brand.name')} size={32} />
          <span data-testid="brand-name">{brandName}</span>
        </span>
        <LanguageSwitcherPlaceholder />
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}
