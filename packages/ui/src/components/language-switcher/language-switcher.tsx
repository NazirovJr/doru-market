import type { ReactElement } from 'react'
import type { Locale } from '@dorutj/i18n'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './language-switcher.css'

/** `import type` — стирается на этапе компиляции, НЕ тянет рантайм `@dorutj/i18n` в бандл
 * (`SRS-UX-036`). Единственное, что нужно компоненту от пакета i18n — тип трёх локалей. */
const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']
const LOCALE_LABELS: Readonly<Record<Locale, string>> = { tj: 'TJ', ru: 'RU', en: 'EN' }

export interface LanguageSwitcherProps {
  readonly currentLocale: Locale
  /** Единственный эффект клика — вызов этого колбэка. Компонент НЕ читает и не проверяет
   * авторизацию/сессию — персистентность выбора (`localStorage`/`PATCH /profile`) целиком на
   * потребителе (`SRS-UX-028`, DTJ-402). */
  readonly onChange: (locale: Locale) => void
  /** Доступное имя `role="group"` — обязателен пропом (`AGENTS.md` «ноль хардкода строк»). */
  readonly 'aria-label': string
  readonly className?: string
}

/**
 * Переключатель локали `TJ/RU/EN` (`SRS-UX-027`) — три пилюли, активная залита
 * `--brand-primary`. Должен присутствовать на КАЖДОМ неавторизованном экране (`SRS-UX-027`);
 * это гарантируется тем, что компонент не принимает и не требует НИ ОДНОГО пропа, связанного с
 * авторизацией — он рендерится и работает идентично что в контексте гостя, что авторизованного
 * пользователя (см. `language-switcher.spec.tsx` «работает без авторизации»).
 */
export const LanguageSwitcher = ({ currentLocale, onChange, className, ...rest }: LanguageSwitcherProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()

  return (
    <div role="group" aria-label={rest['aria-label']} className={cx('ui-language-switcher', className)}>
      {LOCALES.map((locale) => {
        const isActive = locale === currentLocale
        return (
          <button
            key={locale}
            type="button"
            aria-pressed={isActive}
            className={cx(
              'ui-language-switcher__pill',
              isActive && 'ui-language-switcher__pill--active',
              !prefersReducedMotion && 'ui-language-switcher__pill--motion',
            )}
            onClick={() => {
              onChange(locale)
            }}
          >
            {LOCALE_LABELS[locale]}
          </button>
        )
      })}
    </div>
  )
}
