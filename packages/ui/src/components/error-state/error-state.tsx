import type { ReactElement } from 'react'
import type { TranslateFunction, TranslationKey, TranslationParams } from '@dorutj/i18n'
import { Button } from '../button/button.js'
import { cx } from '../shared/cx.js'
import './error-state.css'

export type ErrorStateVariant = 'fullscreen' | 'inline'

const DEFAULT_TITLE_KEY: TranslationKey = 'ux.error.generic_500'
const DEFAULT_RETRY_LABEL_KEY: TranslationKey = 'ux.action.retry'

export interface ErrorStateProps {
  /** Результат вызова `useT()` у потребителя — см. `EmptyState` для того же паттерна. */
  readonly t: TranslateFunction
  readonly variant: ErrorStateVariant
  /** По умолчанию `ux.error.generic_500` — дружелюбный текст БЕЗ технического кода (DoD). */
  readonly titleKey?: TranslationKey
  readonly titleParams?: TranslationParams
  readonly descriptionKey?: TranslationKey
  readonly descriptionParams?: TranslationParams
  /** По умолчанию `ux.action.retry` — подпись кнопки повтора, рендерится только вместе с `onRetry`. */
  readonly retryLabelKey?: TranslationKey
  readonly onRetry?: () => void
  /** Техническая деталь — код ошибки/`requestId`, видна ТОЛЬКО в свёрнутом по умолчанию `<details>`
   * (DoD: «код ошибки скрыт от пользователя, видим в details при явном раскрытии»). */
  readonly errorCode?: string
  readonly requestId?: string
  readonly className?: string
}

interface TechnicalDetailsProps {
  readonly t: TranslateFunction
  readonly errorCode: string | undefined
  readonly requestId: string | undefined
}

/** `<details>` свёрнут по умолчанию (нативный `open`-атрибут отсутствует) — код ошибки/`requestId`
 * попадают в DOM, но не видны пользователю без явного клика по `<summary>` (для скриншота в
 * поддержку, DoD). */
const TechnicalDetails = ({ t, errorCode, requestId }: TechnicalDetailsProps): ReactElement | null => {
  if (errorCode === undefined && requestId === undefined) {
    return null
  }

  return (
    <details className="ui-error-state__details">
      <summary>{t('ux.error.technical_details_summary')}</summary>
      {errorCode !== undefined ? <p>{t('ux.error.technical_details_code', { code: errorCode })}</p> : null}
      {requestId !== undefined ? (
        <p>{t('ux.error.technical_details_request_id', { requestId })}</p>
      ) : null}
    </details>
  )
}

/**
 * Полноэкранная/инлайн ошибка (`SRS-UX-021`, §5 `30-ux-screens-and-flows.md`) — показывает
 * пользователю ТОЛЬКО дружелюбный текст, техническая деталь скрыта в `<details>`. `Button` (DTJ-404)
 * — ЕДИНСТВЕННЫЙ способ рендерить кнопку повтора в этом компоненте (инструкция тикета).
 */
export const ErrorState = ({
  t,
  variant,
  titleKey = DEFAULT_TITLE_KEY,
  titleParams,
  descriptionKey,
  descriptionParams,
  retryLabelKey = DEFAULT_RETRY_LABEL_KEY,
  onRetry,
  errorCode,
  requestId,
  className,
}: ErrorStateProps): ReactElement => (
  <div className={cx('ui-error-state', `ui-error-state--${variant}`, className)} role="alert">
    <p className="ui-error-state__title">{t(titleKey, titleParams)}</p>
    {descriptionKey !== undefined ? (
      <p className="ui-error-state__description">{t(descriptionKey, descriptionParams)}</p>
    ) : null}
    {onRetry !== undefined ? (
      <Button variant="secondary" onClick={onRetry} className="ui-error-state__retry">
        {t(retryLabelKey)}
      </Button>
    ) : null}
    <TechnicalDetails t={t} errorCode={errorCode} requestId={requestId} />
  </div>
)
