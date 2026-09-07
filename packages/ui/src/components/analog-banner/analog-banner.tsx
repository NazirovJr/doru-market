import type { ReactElement } from 'react'
import { formatMoney, type Locale, type TranslateFunction, type TranslationKey } from '@dorutj/i18n'
import { Card } from '../card/card.js'
import { cx } from '../shared/cx.js'
import './analog-banner.css'

/** Оба ключа заведены ЭТИМ тикетом точечно в существующие словари `packages/i18n` (DTJ-407 п.3,
 * координация с DTJ-402) — НЕ пересоздание файла. `disclaimer` — текст `pending_legal_review`
 * (`docs/spec/20-module-catalog-search.md` §6.5, `SRS-CAT-039/041`): плейсхолдер, вычитка юристом
 * ДО прод-релиза не требует изменения структуры компонента, только значения ключа. */
const BANNER_TEXT_KEY: TranslationKey = 'catalog.analogs.inline_banner'
const DISCLAIMER_KEY: TranslationKey = 'catalog.analogs.disclaimer'

export interface AnalogBannerProps {
  readonly substanceName: string
  readonly dosage: string
  /** Целые дирамы — форматирование только через `formatMoney()` (DTJ-402), см. `PriceTag`. */
  readonly analogPriceDiram: number
  readonly referencePriceDiram: number
  /** Уже посчитан бэкендом (`AGENTS.md` «Технический контекст» тикета) — компонент только
   * форматирует, не вычисляет `%` из цен. */
  readonly savingsPercent: number
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly className?: string
}

/**
 * Inline-плашка аналога (`SRS-CAT-036..041`, тикет DTJ-407 п.3) — НЕ модальная (REQ-UX-2):
 * обычный `Card` (DTJ-404, `interactive` не задан → `<div>`), никогда не `role="dialog"`.
 * Дисклеймер рендерится ВСЕГДА, независимо от величины `savingsPercent` (SRS-CAT-039 — «каждый
 * рендеринг блока аналогов», не «показать один раз и закрыть»).
 */
export const AnalogBanner = ({
  substanceName,
  dosage,
  analogPriceDiram,
  referencePriceDiram,
  savingsPercent,
  locale,
  t,
  className,
}: AnalogBannerProps): ReactElement => (
  <Card className={cx('ui-analog-banner', className)}>
    <p className="ui-analog-banner__text">
      {t(BANNER_TEXT_KEY, {
        substanceName,
        dosage,
        analogPrice: formatMoney(analogPriceDiram, locale),
        referencePrice: formatMoney(referencePriceDiram, locale),
        savingsPercent,
      })}
    </p>
    <p className="ui-analog-banner__disclaimer">{t(DISCLAIMER_KEY)}</p>
  </Card>
)
