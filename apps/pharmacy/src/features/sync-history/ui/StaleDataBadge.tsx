import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import type { InventorySyncBatchListItemDto, TenantMetaDto } from '@dorutj/contracts'
import { useTenantMeta } from '@/shared/api/use-tenant-meta'

const MINUTES_PER_HOUR = 60
const MS_PER_MINUTE = 60_000

export interface StaleDataBadgeProps {
  readonly freshestBatch: InventorySyncBatchListItemDto | null
  readonly now?: Date
}

export function computeElapsedMinutes(now: Date, receivedAt: Date): number {
  return Math.max(0, (now.getTime() - receivedAt.getTime()) / MS_PER_MINUTE)
}

/** REST (1С) — непрерывная дельта-синхронизация, порог в минутах из тенанта; остальные каналы
 * синхронизируются нерегулярно, порог в часах (DTJ-033, `GET /tenant/meta`, заменяет прежние
 * хардкоженные клиентские дефолты, снятые этим тикетом). */
export function resolveStaleThresholdMinutes(channel: InventorySyncBatchListItemDto['channel'], meta: TenantMetaDto): number {
  return channel === 'rest' ? meta.inventoryDeltaSlaMinutes : meta.inventoryManualStaleHours * MINUTES_PER_HOUR
}

export function isBatchStale(now: Date, batch: InventorySyncBatchListItemDto, meta: TenantMetaDto): boolean {
  const elapsedMinutes = computeElapsedMinutes(now, new Date(batch.receivedAt))
  return elapsedMinutes > resolveStaleThresholdMinutes(batch.channel, meta)
}

export function hoursSinceReceived(now: Date, receivedAt: string): number {
  return Math.floor(computeElapsedMinutes(now, new Date(receivedAt)) / MINUTES_PER_HOUR)
}

export const StaleDataBadge = ({ freshestBatch, now }: StaleDataBadgeProps): ReactElement | null => {
  const { t } = useT('tj')
  const { data: meta } = useTenantMeta(freshestBatch !== null)
  const currentTime = now ?? new Date()

  if (freshestBatch === null) {
    return (
      <p className="text-sm text-ink-muted" data-testid="stale-data-badge-empty">
        {t('pharmacy.inventory.sync_history.stale.no_data')}
      </p>
    )
  }

  if (meta === undefined) {
    // Пороги SLA (DTJ-033) ещё не загружены — короткий флеш без бейджа безопаснее фолбэка
    // на устаревшие клиентские дефолты (тот же приём, что `ModerationBanner` на этой странице).
    return null
  }

  const stale = isBatchStale(currentTime, freshestBatch, meta)
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
