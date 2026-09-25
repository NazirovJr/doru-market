import type { ReactElement } from 'react'
import type { Locale } from '@dorutj/i18n'

// TODO(DTJ-408): заменить на реальный LanguageSwitcher из packages/ui — здесь декоративная заглушка, apps/pharmacy пока без LocaleProvider.
const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

export const LanguageSwitcherPlaceholder = (): ReactElement => (
  <div className="flex items-center gap-2 text-xs text-ink-muted" data-testid="language-switcher-placeholder">
    {LOCALES.map((locale) => (
      <span key={locale} className="uppercase">
        {locale}
      </span>
    ))}
  </div>
)
