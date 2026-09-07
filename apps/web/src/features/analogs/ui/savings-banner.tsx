import type { ReactElement } from 'react'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import { SavingsBadge } from '@dorutj/ui'

/**
 * `savings-banner.tsx` (DTJ-104/431, `SRS-CAT-036/038`, `TC-CAT-013`).
 *
 * Плашка «Сэкономьте N сомони» — DTJ-431 перенесла её на `SavingsBadge` (`@dorutj/ui`, DTJ-407),
 * который форматирует деньги через `formatMoney()` (единственный легальный способ, AGENTS.md §6) —
 * локальный `formatSavings`/ручной `Intl.NumberFormat` больше не нужен.
 *
 * `catalog.analogs.savings_label` («Сэкономьте {amount}») — новый ключ `SavingsBadge`, суффикс
 * валюты уже входит в `{amount}` (результат `formatMoney()`), задваивать «сомони» в тексте ключа
 * нельзя (см. JSDoc `packages/ui/src/components/savings-badge/savings-badge.tsx`).
 *
 * `explanation` — обязательный проп `SavingsBadge` (REQ-UX-1: изолированная цифра экономии без
 * контекста запрещена); переиспользован СУЩЕСТВУЮЩИЙ ключ `catalog.analogs.title_neutral`
 * («Другие варианты с тем же действующим веществом») — тот же смысл, что нужен здесь как
 * пояснение к цифре экономии, второй ключ с идентичным смыслом не заводим (AGENTS.md §12/Ж12).
 *
 * Родитель (`ui/analogs-block.tsx`) рендерит этот компонент ТОЛЬКО когда `titleKey ===
 * 'catalog.analogs.title_savings'` — сам компонент это условие не проверяет.
 */

const TITLE_NEUTRAL_I18N_KEY = 'catalog.analogs.title_neutral'

export interface SavingsBannerProps {
  readonly savingsDiram: number
  readonly locale: Locale
  readonly t: TranslateFunction
}

export const SavingsBanner = ({ savingsDiram, locale, t }: SavingsBannerProps): ReactElement => (
  <div data-testid="analogs-savings-banner">
    <SavingsBadge savingsDiram={savingsDiram} locale={locale} t={t} explanation={t(TITLE_NEUTRAL_I18N_KEY)} />
  </div>
)
