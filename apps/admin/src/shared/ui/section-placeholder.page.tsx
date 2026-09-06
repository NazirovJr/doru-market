/**
 * `SectionPlaceholderPage` (DTJ-350, EP-15) — общий placeholder для ВСЕХ 13 разделов
 * `super_admin`/`pharmacy_admin`, объявленных в `role-routes.ts`. Ни один раздел
 * (Тенанты/Фиче-флаги/Аптеки/…) ещё не реализован — это ответственность следующих тикетов
 * эпика (DTJ-351..367). Каждый из них заменяет `component` СВОЕЙ записи `role-routes.ts` на
 * реальную страницу — этот файл замены не требует и не трогается (одна строка на тикет).
 *
 * `packages/ui` пока не содержит компонентов (заглушка EP-18, `packages/ui/src/index.ts` —
 * пустой барабан) — здесь минимальная локальная вёрстка без хардкода строк (`useT()`,
 * `pharmacy.page.coming_soon` — уже существующий, общий для всех apps ключ, не заводим новый).
 */
import { type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'

/** Локаль зафиксирована временно — `apps/admin` ещё не имеет своего провайдера локали (см. риски DTJ-350). */
const DEFAULT_LOCALE = 'tj' as const

export interface SectionPlaceholderPageProps {
  /** Ключ словаря `admin.nav.*` для заголовка раздела (напр. `admin.nav.tenants`). */
  readonly titleKey: string
}

export const SectionPlaceholderPage = ({ titleKey }: SectionPlaceholderPageProps): ReactElement => {
  const { t } = useT(DEFAULT_LOCALE)
  return (
    <section data-testid="section-placeholder">
      <h2>{t(titleKey)}</h2>
      <p>{t('pharmacy.page.coming_soon')}</p>
    </section>
  )
}
