import type { ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'
import { cx } from '../shared/cx.js'
import './offline-banner.css'

export interface OfflineBannerProps {
  /** Результат вызова `useT()` у потребителя — см. `EmptyState`. */
  readonly t: TranslateFunction
  /** Управляется потребителем через `navigator.onLine`/события `online`/`offline` (AC1) —
   * `OfflineBanner` сам не подписывается на сеть, только отражает переданное состояние. */
  readonly isOnline: boolean
  /** `false` (по умолчанию) — полноэкранный форм-фактор на списках, `true` — компактный инлайн на
   * детальных экранах (тикет п.5: ОДИН компонент с двумя размерами, не два разных компонента). */
  readonly compact?: boolean
}

/**
 * ЕДИНЫЙ баннер потери сети (`SRS-UX-021`/`024`, DTJ-406 п.5 — исправляет находку
 * `32-design-reference.md`: дизайн давал разные форм-факторы с разными формулировками). Текст
 * ВСЕГДА `ux.error.network_offline`, дословно. НЕТ элемента закрытия в DOM ни при каком состоянии
 * пропсов (AC1) — баннер либо отсутствует в DOM целиком (`isOnline === true`), либо показан без
 * возможности его скрыть до восстановления сети.
 */
export const OfflineBanner = ({ t, isOnline, compact = false }: OfflineBannerProps): ReactElement | null => {
  if (isOnline) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx('ui-offline-banner', compact && 'ui-offline-banner--compact')}
    >
      <OfflineIcon />
      <p className="ui-offline-banner__text">{t('ux.error.network_offline')}</p>
    </div>
  )
}

const OfflineIcon = (): ReactElement => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" className="ui-offline-banner__icon">
    <path
      d="M2 2l16 16M6.5 6.8A8 8 0 0 1 17 8m-3 3a4 4 0 0 1 1.3.9M10 15h.01"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
