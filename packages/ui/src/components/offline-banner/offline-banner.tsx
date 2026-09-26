/**
 * `OfflineBanner` (DTJ-406, `SRS-UX-024`/`SRS-UX-021`) — ЕДИНЫЙ компонент для ЛЮБОГО контекста
 * «нет сети» (исправляет находку `32-design-reference.md`: разные экраны раньше изобретали
 * собственный баннер офлайна с разным текстом). Текст ВСЕГДА `ux.error.network_offline` — не
 * настраивается пропом, НЕТ свободного текста как API вообще (даже ключа — компонент жёстко
 * привязан к одному ключу, потому что задача тикета — унификация, а не гибкость).
 *
 * `isOnline` — управляется ПОТРЕБИТЕЛЕМ (`navigator.onLine`/событие `online`/`offline`, см.
 * `use-connection-status.ts`), баннер сам не слушает сеть — так проще тестировать и держать
 * компонент чистым представлением состояния. Критерий приёмки 1: НЕТ кнопки/элемента закрытия
 * в DOM ни при каком состоянии пропсов (не находит, потому что вообще не рендерит) — пока
 * `isOnline === false`, баннер виден без какого-либо способа его скрыть вручную.
 *
 * `compact` — ДВА визуальных РАЗМЕРА одного компонента (полноэкранный на списках/компактный
 * инлайн на детальных экранах), а не два разных компонента с разным текстом.
 */
import { type ReactElement } from 'react'
import { type TranslateFunction } from '@dorutj/i18n'

export interface OfflineBannerProps {
  readonly t: TranslateFunction
  readonly isOnline: boolean
  /** `true` — компактный инлайн-режим (детальные экраны), `false` — полноэкранный (списки). */
  readonly compact?: boolean
}

const ICON_SIZE_PX = 20

const OfflineIcon = (): ReactElement => (
  <svg aria-hidden="true" width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 20 20" fill="none">
    <path
      d="M2 2l16 16M10 15.5h.01M6.5 12a5 5 0 0 1 4-1.9M13.5 12a5 5 0 0 0-1.6-1.15M3.3 8.8A9 9 0 0 1 8 6.4M16.7 8.8a8.98 8.98 0 0 0-2.4-1.9"
      stroke="var(--brand-warning-text)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export const OfflineBanner = ({ t, isOnline, compact = false }: OfflineBannerProps): ReactElement | null => {
  if (isOnline) {
    return null
  }
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="dorutj-offline-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: compact ? 'flex-start' : 'center',
        gap: 'var(--space-2)',
        width: '100%',
        boxSizing: 'border-box',
        padding: compact ? 'var(--space-2) var(--space-3)' : 'var(--space-4)',
        background: 'var(--brand-warning-bg)',
        border: `1px solid var(--brand-warning-border)`,
        borderRadius: compact ? 'var(--radius-sm)' : 0,
        color: 'var(--brand-warning-text)',
        fontFamily: 'var(--brand-font-family)',
        fontSize: compact ? 'var(--font-size-sm)' : 'var(--font-size-base)',
        textAlign: compact ? 'left' : 'center',
      }}
    >
      <OfflineIcon />
      <span>{t('ux.error.network_offline')}</span>
    </div>
  )
}
