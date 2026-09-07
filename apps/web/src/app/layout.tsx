import { Outlet } from 'react-router'
import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { BrandLogo, LanguageSwitcher } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'

export const AppLayout = (): ReactElement => {
  const { locale, setLocale } = useLocale()
  const { t } = useT(locale)

  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <BrandLogo alt={t('brand.logo_alt', { brand: t('brand.name') })} />
        <LanguageSwitcher
          currentLocale={locale}
          onChange={setLocale}
          aria-label={t('common.language_switcher_label')}
        />
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}
