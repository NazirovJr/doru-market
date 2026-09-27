import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, ErrorState, Skeleton, Tabs, type TabItem } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
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

const ModerationBanner = ({ pharmacyId }: { readonly pharmacyId: string | null }): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)
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
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [channel, setChannel] = useState<SyncChannelFilter>('all')
  const pharmacyId = useCurrentPharmacyId()
  const { items, freshestBatch, isInitialLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } = useSyncHistoryState(channel)

  const filterTabs: TabItem[] = SYNC_CHANNEL_FILTERS.map((filterValue) => ({
    id: filterValue,
    label: t(`pharmacy.inventory.sync_history.filter.${filterValue}`),
  }))

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-8" data-testid="sync-history-page">
      <h1 className="text-lg font-semibold text-ink">{t('pharmacy.inventory.sync_history.page_title')}</h1>

      <StaleDataBadge freshestBatch={freshestBatch} />
      <ModerationBanner pharmacyId={pharmacyId} />

      <Tabs
        tabs={filterTabs}
        activeId={channel}
        onChange={(id) => { setChannel(id as SyncChannelFilter) }}
        aria-label={t('pharmacy.inventory.sync_history.page_title')}
      />

      {isInitialLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      ) : null}
      {error !== null ? <ErrorState t={t} titleKey="pharmacy.inventory.sync_history.error" variant="inline" /> : null}

      {!isInitialLoading && error === null ? <SyncBatchesTable items={items} /> : null}

      {hasNextPage ? (
        <Button
          type="button"
          variant="secondary"
          onClick={fetchNextPage}
          disabled={isFetchingNextPage}
          loading={isFetchingNextPage}
          data-testid="sync-history-load-more"
        >
          {t('pharmacy.inventory.sync_history.load_more')}
        </Button>
      ) : null}
    </section>
  )
}

export default SyncHistoryPage
