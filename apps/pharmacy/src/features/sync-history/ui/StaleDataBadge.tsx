import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import type { InventorySyncBatchListItemDto } from '@dorutj/contracts'

// TODO(EP-01/EP-02): GET /meta для кабинета аптеки ещё не существует — дефолты хардкожены, читать оттуда, когда появится.
const DEFAULT_INVENTORY_DELTA_SLA_MINUTES = 5
const DEFAULT_INVENTORY_MANUAL_STALE_HOURS = 72
const MINUTES_PER_HOUR = 60
const MS_PER_MINUTE = 60_000

export interface StaleDataBadgeProps {
  readonly freshestBatch: InventorySyncBatchListItemDto | null
  readonly now?: Date
}

export function computeElapsedMinutes(now: Date, receivedAt: Date): number {
  return Math.max(0, (now.getTime() - receivedAt.getTime()) / MS_PER_MINUTE)
}

/** REST (1С) — непрерывная дельта-синхронизация, порог в минутах; остальные каналы синхронизируются нерегулярно, порог в часах. */
export function resolveStaleThresholdMinutes(channel: InventorySyncBatchListItemDto['channel']): number {
  return channel === 'rest'
    ? DEFAULT_INVENTORY_DELTA_SLA_MINUTES
    : DEFAULT_INVENTORY_MANUAL_STALE_HOURS * MINUTES_PER_HOUR
}

export function isBatchStale(now: Date, batch: InventorySyncBatchListItemDto): boolean {
  const elapsedMinutes = computeElapsedMinutes(now, new Date(batch.receivedAt))
  return elapsedMinutes > resolveStaleThresholdMinutes(batch.channel)
}

export function hoursSinceReceived(now: Date, receivedAt: string): number {
  return Math.floor(computeElapsedMinutes(now, new Date(receivedAt)) / MINUTES_PER_HOUR)
}

export const StaleDataBadge = ({ freshestBatch, now }: StaleDataBadgeProps): ReactElement => {
  const { t } = useT('tj')
  const currentTime = now ?? new Date()

  if (freshestBatch === null) {
    return (
      <p className="text-sm text-ink-muted" data-testid="stale-data-badge-empty">
        {t('pharmacy.inventory.sync_history.stale.no_data')}
      </p>
    )
  }

  const stale = isBatchStale(currentTime, freshestBatch)
  const hours = hoursSinceReceived(currentTime, freshestBatch.receivedAt)

  return (
    <div
      className={`flex flex-col gap-1 rounded-md border p-3 ${stale ? 'border-brand-warning' : 'border-line'}`}
      data-testid="stale-data-badge"
      data-stale={stale}
    >
      <p className={stale ? 'text-sm font-medium text-brand-warning' : 'text-sm text-ink'}>
        {t('pharmacy.inventory.sync_history.stale.label', { hours })}
      </p>
      {stale ? (
        <p className="text-xs text-brand-warning" role="alert">
          {t('pharmacy.inventory.sync_history.stale.warning')}
        </p>
      ) : null}
    </div>
  )
}
