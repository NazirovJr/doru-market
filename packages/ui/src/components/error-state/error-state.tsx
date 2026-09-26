/**
 * `ErrorState` (DTJ-406, `SRS-UX-021`/`SRS-UX-024`) — полноэкранный/инлайн (`variant`) дружелюбный
 * экран ошибки. Пользователю виден ТОЛЬКО переведённый `titleKey`/`descriptionKey` (например
 * `ux.error.generic_500`) — техническая деталь (`errorCode`/`requestId`) скрыта в `<details>`
 * (закрыт по умолчанию, `SRS-UX-024`: раскрывается явным действием, для скриншота в поддержку).
 *
 * `titleKey`/`descriptionKey`/`retryLabelKey` — `TranslationKey`, не свободный текст (тот же
 * контракт, что `EmptyState`, см. её JSDoc): технические `errorCode`/`requestId` — единственные
 * СВОБОДНЫЕ строки этого компонента, потому что это не пользовательский текст, а диагностический
 * идентификатор (не переводится ни при какой локали).
 */
import { type CSSProperties, type ReactElement } from 'react'
import { type TranslateFunction, type TranslationKey, type TranslationParams } from '@dorutj/i18n'
import { Button } from '../button/button'

export type ErrorStateVariant = 'fullscreen' | 'inline'

export interface ErrorStateProps {
  readonly t: TranslateFunction
  readonly titleKey: TranslationKey
  readonly titleParams?: TranslationParams
  readonly descriptionKey?: TranslationKey
  readonly descriptionParams?: TranslationParams
  readonly variant?: ErrorStateVariant
  /** Технический код ошибки — НЕ переводится, показан только внутри раскрытых деталей. */
  readonly errorCode?: string
  /** `requestId` — НЕ переводится, показан только внутри раскрытых деталей. */
  readonly requestId?: string
  readonly onRetry?: () => void
  /** По умолчанию `ux.action.retry`. */
  readonly retryLabelKey?: TranslationKey
}

const DEFAULT_RETRY_LABEL_KEY: TranslationKey = 'ux.action.retry'
const ICON_SIZE_PX = 48
const CONTAINER_GAP_PX = 12

const VARIANT_CONTAINER_STYLE: Readonly<Record<ErrorStateVariant, CSSProperties>> = {
  fullscreen: { minHeight: '60vh', justifyContent: 'center', padding: 'var(--space-8) var(--space-4)' },
  inline: { padding: 'var(--space-6) var(--space-4)' },
}

const ErrorGlyph = (): ReactElement => (
  <svg aria-hidden="true" width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" stroke="var(--brand-danger-border)" strokeWidth="2" />
    <path d="M24 15v12" stroke="var(--brand-danger)" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="24" cy="33" r="1.5" fill="var(--brand-danger)" />
  </svg>
)

interface TechnicalDetailsProps {
  readonly t: TranslateFunction
  readonly errorCode?: string | undefined
  readonly requestId?: string | undefined
}

const TechnicalDetails = ({ t, errorCode, requestId }: TechnicalDetailsProps): ReactElement | null => {
  if (errorCode === undefined && requestId === undefined) {
    return null
  }
  return (
    <details style={{ fontSize: 'var(--font-size-xs)', color: 'var(--brand-text-muted)' }}>
      <summary style={{ cursor: 'pointer' }}>{t('ux.error.details_toggle')}</summary>
      <div style={{ marginTop: 'var(--space-1)', textAlign: 'left' }}>
        {errorCode !== undefined && <p style={{ margin: 0 }}>{t('ux.error.details_error_code', { code: errorCode })}</p>}
        {requestId !== undefined && <p style={{ margin: 0 }}>{t('ux.error.details_request_id', { requestId })}</p>}
      </div>
    </details>
  )
}

export const ErrorState = ({
  t,
  titleKey,
  titleParams,
  descriptionKey,
  descriptionParams,
  variant = 'fullscreen',
  errorCode,
  requestId,
  onRetry,
  retryLabelKey = DEFAULT_RETRY_LABEL_KEY,
}: ErrorStateProps): ReactElement => (
  <div
    role="alert"
    data-testid="dorutj-error-state"
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: `${String(CONTAINER_GAP_PX)}px`,
      fontFamily: 'var(--brand-font-family)',
      ...VARIANT_CONTAINER_STYLE[variant],
    }}
  >
    <ErrorGlyph />
    <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--brand-text)' }}>
      {t(titleKey, titleParams)}
    </h3>
    {descriptionKey !== undefined && (
      <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--brand-text-muted)' }}>
        {t(descriptionKey, descriptionParams)}
      </p>
    )}
    {onRetry !== undefined && (
      <Button variant="secondary" onClick={onRetry} style={{ marginTop: 'var(--space-2)' }}>
        {t(retryLabelKey)}
      </Button>
    )}
    <TechnicalDetails t={t} errorCode={errorCode} requestId={requestId} />
  </div>
)
