import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import {
  SYNC_CHANNEL_FILTERS,
  useCurrentPharmacyId,
  usePendingModerationCount,
  useSyncBatches,
  type SyncChannelFilter,
  type UseSyncBatchesResult,
} from '@/features/sync-history/api/use-sync-batches'
import { SyncBatchesTable } from '@/features/sync-history/ui/SyncBatchesTable'
import { StaleDataBadge } from '@/features/sync-history/ui/StaleDataBadge'

// useSyncBatches вызывается дважды безусловно (Rules of Hooks): 'all' — для самого свежего батча независимо от фильтра,
// channel — для таблицы; при channel==='all' оба используют один queryKey, повторного запроса не происходит.
interface SyncHistoryState extends UseSyncBatchesResult {
  readonly freshestBatch: UseSyncBatchesResult['items'][number] | null
}

function useSyncHistoryState(channel: SyncChannelFilter): SyncHistoryState {
  const allBatches = useSyncBatches('all')
  const filtered = useSyncBatches(channel)
  return { ...filtered, freshestBatch: allBatches.items[0] ?? null }
}

const FilterChip = ({
  active,
  onClick,
  testId,
  children,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly testId: string
  readonly children: string
}): ReactElement => {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={`rounded-full border px-3 py-1 text-sm ${active ? 'border-brand-primary text-brand-primary' : 'border-line text-ink-muted'}`}
    >
      {children}
    </button>
  )
}

const ModerationBanner = ({ pharmacyId }: { readonly pharmacyId: string | null }): ReactElement | null => {
  const { t } = useT('tj')
  const query = usePendingModerationCount(pharmacyId)
  if (query.data === undefined || query.data.pendingCount === 0) {
    return null
  }
  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm text-ink" data-testid="moderation-banner">
      {t('pharmacy.inventory.sync_history.moderation.banner', { count: query.data.pendingCount })}
    </div>
  )
}

const SyncHistoryPage = (): ReactElement => {
  const { t } = useT('tj')
  const [channel, setChannel] = useState<SyncChannelFilter>('all')
  const pharmacyId = useCurrentPharmacyId()
  const { items, freshestBatch, isInitialLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } = useSyncHistoryState(channel)

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-8" data-testid="sync-history-page">
      <h1 className="text-lg font-semibold text-ink">{t('pharmacy.inventory.sync_history.page_title')}</h1>

      <StaleDataBadge freshestBatch={freshestBatch} />
      <ModerationBanner pharmacyId={pharmacyId} />

      <div role="tablist" className="flex flex-wrap gap-2">
        {SYNC_CHANNEL_FILTERS.map((filterValue) => (
          <FilterChip
            key={filterValue}
            active={channel === filterValue}
            onClick={() => { setChannel(filterValue) }}
            testId={`sync-history-filter-${filterValue}`}
          >
            {t(`pharmacy.inventory.sync_history.filter.${filterValue}`)}
          </FilterChip>
        ))}
      </div>

      {isInitialLoading ? <p className="text-sm text-ink-muted">{t('pharmacy.inventory.sync_history.loading')}</p> : null}
      {error !== null ? <p role="alert" className="text-sm text-brand-danger">{t('pharmacy.inventory.sync_history.error')}</p> : null}

      {!isInitialLoading && error === null ? <SyncBatchesTable items={items} /> : null}

      {hasNextPage ? (
        <button
          type="button"
          onClick={fetchNextPage}
          disabled={isFetchingNextPage}
          data-testid="sync-history-load-more"
          className="self-start rounded-md border border-line px-3 py-1 text-sm text-ink"
        >
          {t(isFetchingNextPage ? 'pharmacy.inventory.sync_history.load_more_pending' : 'pharmacy.inventory.sync_history.load_more')}
        </button>
      ) : null}
    </section>
  )
}

export default SyncHistoryPage
