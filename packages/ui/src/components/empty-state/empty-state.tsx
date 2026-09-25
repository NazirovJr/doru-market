/**
 * `EmptyState` (DTJ-406, `SRS-UX-023`/`SRS-UX-024`) — иконка + заголовок + подзаголовок +
 * опциональный CTA для пустых списков (`ux.empty.search_no_results`, `ux.empty.cart`,
 * `ux.empty.orders`, `ux.empty.offers_pool`, `ux.empty.order_queue`, DTJ-402).
 *
 * `titleKey`/`descriptionKey`/`ctaLabelKey` типизированы `TranslationKey` (`keyof` словаря `ru`,
 * `@dorutj/i18n`) — передача произвольного `string` НЕ компилируется (тест-план DTJ-406:
 * «отказывается от рендера — TS-ошибка компиляции — если передан произвольный string»). `t` —
 * готовый результат `useT()` потребителя (пакет не владеет локалью/провайдером — она приходит
 * из `apps/*`), не вызывается здесь заново.
 */
import { type ReactElement, type ReactNode } from 'react'
import { type TranslateFunction, type TranslationKey, type TranslationParams } from '@dorutj/i18n'
import { Button } from '../button/button'

const ICON_SIZE_PX = 48
const CONTAINER_GAP_PX = 12
const CONTAINER_PADDING_Y_PX = 32

export interface EmptyStateProps {
  readonly t: TranslateFunction
  readonly titleKey: TranslationKey
  readonly titleParams?: TranslationParams
  readonly descriptionKey?: TranslationKey
  readonly descriptionParams?: TranslationParams
  readonly icon?: ReactNode
  readonly ctaLabelKey?: TranslationKey
  readonly ctaParams?: TranslationParams
  readonly onCtaClick?: () => void
}

const DefaultIcon = (): ReactElement => (
  <svg aria-hidden="true" width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" stroke="var(--brand-border)" strokeWidth="2" />
    <path d="M16 24h16M24 16v16" stroke="var(--brand-text-muted)" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

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
}: EmptyStateProps): ReactElement => (
  <div
    role="status"
    data-testid="dorutj-empty-state"
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: `${String(CONTAINER_GAP_PX)}px`,
      padding: `${String(CONTAINER_PADDING_Y_PX)}px var(--space-4)`,
      fontFamily: 'var(--brand-font-family)',
    }}
  >
    {icon ?? <DefaultIcon />}
    <h3
      style={{
        margin: 0,
        fontSize: 'var(--font-size-md)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--brand-text)',
      }}
    >
      {t(titleKey, titleParams)}
    </h3>
    {descriptionKey !== undefined && (
      <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--brand-text-muted)' }}>
        {t(descriptionKey, descriptionParams)}
      </p>
    )}
    {ctaLabelKey !== undefined && onCtaClick !== undefined && (
      <Button variant="primary" onClick={onCtaClick} style={{ marginTop: 'var(--space-2)' }}>
        {t(ctaLabelKey, ctaParams)}
      </Button>
    )}
  </div>
)
