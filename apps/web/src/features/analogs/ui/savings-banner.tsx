import type { ReactElement } from 'react'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import { formatSavings } from '../model/format-savings'

/**
 * `savings-banner.tsx` (DTJ-104, `SRS-CAT-036/038`, `TC-CAT-013`).
 *
 * Плашка «Сэкономьте N сомони». Текст — через `useT()`/ключ `catalog.analogs.title_savings` с
 * параметром `{amount}` (форматированным `formatSavings`) — НЕ raw-строка из API-ответа
 * напрямую: API возвращает `savingsDiram`-число и `titleKey`, а не готовый локализованный текст,
 * фронт сам подставляет параметр в i18n-шаблон, чтобы смена языка на клиенте не требовала
 * повторного запроса к API (тикет DTJ-104 п.5).
 *
 * Плейсхолдер словаря — `{amount}` (одна фигурная скобка), а НЕ `{{amount}}` — синтаксис
 * `packages/i18n/src/use-t.ts` (`PARAM_PATTERN = /\{(\w+)\}/g`, DTJ-004 п.3) отличается от
 * записи в `docs/spec/20-module-catalog-search.md` SRS-CAT-038 (там `{{amount}}`, Handlebars-
 * подобный синтаксис) — код первичнее устаревшей нотации спеки, см. DISPUTED отчёта сдачи.
 *
 * Родитель (`ui/analogs-block.tsx`) рендерит этот компонент ТОЛЬКО когда `titleKey ===
 * 'catalog.analogs.title_savings'` — сам компонент это условие не проверяет (следует решению,
 * уже принятому сервером, DTJ-104 п.3).
 */

const TITLE_SAVINGS_I18N_KEY = 'catalog.analogs.title_savings'

export interface SavingsBannerProps {
  readonly savingsDiram: number
  readonly locale: Locale
  readonly t: TranslateFunction
}

export const SavingsBanner = ({ savingsDiram, locale, t }: SavingsBannerProps): ReactElement => (
  <div
    data-testid="analogs-savings-banner"
    role="status"
    className="rounded-md bg-brand-primary/10 px-3 py-2 text-sm font-semibold text-brand-primary"
  >
    {t(TITLE_SAVINGS_I18N_KEY, { amount: formatSavings(savingsDiram, locale) })}
  </div>
)
