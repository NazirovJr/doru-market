import type { ReactElement, ReactNode } from 'react'
import type { TranslateFunction, TranslationKey, TranslationParams } from '@dorutj/i18n'
import { Button } from '../button/button.js'
import { cx } from '../shared/cx.js'
import './empty-state.css'

export interface EmptyStateProps {
  /** Результат вызова `useT()` у потребителя (DTJ-406: «принимает titleKey/descriptionKey ...
   * либо готовый useT()-результат») — `EmptyState` сам не резолвит локаль, только применяет `t`
   * к переданным ключам. */
  readonly t: TranslateFunction
  /** ОБЯЗАН быть ключом словаря `@dorutj/i18n` (`ux.empty.*`), не произвольная строка — передача
   * `string` вместо `TranslationKey` не компилируется (DoD, тест-план DTJ-406). */
  readonly titleKey: TranslationKey
  readonly titleParams?: TranslationParams
  readonly descriptionKey?: TranslationKey
  readonly descriptionParams?: TranslationParams
  readonly icon?: ReactNode
  readonly ctaLabelKey?: TranslationKey
  readonly ctaParams?: TranslationParams
  readonly onCtaClick?: () => void
  readonly className?: string
}

/** Иконка-заглушка по умолчанию (декоративная, `aria-hidden`) — используется, если потребитель не
 * передал свою `icon` (например `catalog.search.no_results` пока не имеет иллюстрации). */
const DefaultIcon = (): ReactElement => (
  <svg aria-hidden="true" width="48" height="48" viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" opacity="0.35" />
    <path d="M16 24h16M24 16v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
  </svg>
)

/**
 * Пустой список/результат (`SRS-UX-021`, §5 `30-ux-screens-and-flows.md`) — иконка + заголовок +
 * подзаголовок + опциональный CTA. Используется для `ux.empty.search_no_results`/`cart`/`orders`/
 * `offers_pool`/`order_queue` (DTJ-402). CTA переиспользует `Button` (DTJ-404), не пишет кнопку с
 * нуля.
 */
export const EmptyState = ({
  t,
  titleKey,
  titleParams,
  descriptionKey,
  descriptionParams,
  icon,
  ctaLabelKey,
  ctaParams,
  onCtaClick,
  className,
}: EmptyStateProps): ReactElement => (
  <div className={cx('ui-empty-state', className)} role="status">
    <div className="ui-empty-state__icon" aria-hidden="true">
      {icon ?? <DefaultIcon />}
    </div>
    <p className="ui-empty-state__title">{t(titleKey, titleParams)}</p>
    {descriptionKey !== undefined ? (
      <p className="ui-empty-state__description">{t(descriptionKey, descriptionParams)}</p>
    ) : null}
    {ctaLabelKey !== undefined && onCtaClick !== undefined ? (
      <Button variant="secondary" onClick={onCtaClick} className="ui-empty-state__cta">
        {t(ctaLabelKey, ctaParams)}
      </Button>
    ) : null}
  </div>
)
