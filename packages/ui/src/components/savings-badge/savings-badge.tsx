/**
 * `SavingsBadge` (DTJ-407, `SRS-UX-002`/`SRS-UX-021`, REQ-UX-1) — акцентный бейдж «Сэкономьте N
 * сомони», собранный поверх `Badge` (DTJ-404, `tone="success"`, переиспользование — правило 12
 * AGENTS.md). Сумма экономии — исключительно через `formatMoney()` (`@dorutj/i18n`, DTJ-402), тот
 * же приём, что `PriceTag` (компонент НЕ содержит собственной денежной арифметики).
 *
 * REQ-UX-1 (риски тикета): изолированная цифра экономии БЕЗ контекста запрещена — рядом с бейджем
 * ВСЕГДА рендерится поясняющий текст (`ux.savings.badge_explanation`), а не только число. Оба
 * узла — обязательная часть разметки компонента, не опциональный слот потребителя.
 *
 * НЕ дублирует `catalog.analogs.title_savings`/`SRS-CAT-038 catalog.analogs.savings_banner`
 * (`apps/web/src/features/analogs/ui/savings-banner.tsx`, DTJ-104) — те ключи принимают СЫРУЮ
 * (без суффикса валюты) числовую строку и сами достраивают слово «сомони»/«сомонӣ» литералом в
 * шаблоне; здесь `{amount}` — уже ПОЛНАЯ строка `formatMoney()` (с суффиксом), поэтому ключи этого
 * компонента (`ux.savings.badge_title`/`badge_explanation`) НЕ содержат литерала валюты сами —
 * смешивание двух конвенций форматирования в одном шаблоне задвоило бы суффикс («N сомони сомони»).
 */
import { type ReactElement } from 'react'
import { type Locale, type TranslateFunction, formatMoney } from '@dorutj/i18n'
import { Badge } from '../badge/badge'

export interface SavingsBadgeProps {
  /** Экономия, целые дирамы (AGENTS.md правило 6) — сумма уже посчитана бэкендом (DTJ-407 §2). */
  readonly savingsDiram: number
  readonly locale: Locale
  readonly t: TranslateFunction
}

export const SavingsBadge = ({ savingsDiram, locale, t }: SavingsBadgeProps): ReactElement => (
  <span
    data-testid="savings-badge"
    style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 'var(--space-1)',
      fontFamily: 'var(--brand-font-family)',
    }}
  >
    <Badge tone="success">{t('ux.savings.badge_title', { amount: formatMoney(savingsDiram, locale) })}</Badge>
    <span
      data-testid="savings-badge-explanation"
      style={{
        fontSize: 'var(--font-size-xs)',
        color: 'var(--brand-text-muted)',
      }}
    >
      {t('ux.savings.badge_explanation')}
    </span>
  </span>
)
