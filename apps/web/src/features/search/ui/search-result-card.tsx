/**
 * `search-result-card.tsx` (DTJ-193, `SRS-CAT-011`/`056`).
 *
 * Одна карточка результата поиска. Чисто презентационный компонент — состояние (загрузка/
 * пагинация/ошибки) держит `search-results-page.tsx`.
 *
 * `tradeName`/`dosageForm`/`dosageStrength`/`innName`/`pharmacyName` — ДАННЫЕ с бэкенда, не
 * UI-строки интерфейса, поэтому не проходят через `useT()` (тот же принцип, что
 * `pharmacy-pin-popup.tsx`, DTJ-198, — имя аптеки выводится как есть).
 *
 * Rx-бейдж — `SRS-CAT-056` п.2: обязателен в ОСНОВНОЙ выдаче поиска, не только в блоке аналогов.
 * `isStale` переиспользует существующий ключ `map.pin.stale` (`packages/i18n`) — тот же смысл
 * («цена могла устареть»), заводить дубль запрещено правилом Ж12.
 */
import type { ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'
import type { SearchResultItemDto } from '@dorutj/contracts'

const DIRAM_PER_SOMONI = 100

function formatSomoni(priceDiram: number): string {
  return (priceDiram / DIRAM_PER_SOMONI).toFixed(2)
}

export interface SearchResultCardProps {
  readonly item: SearchResultItemDto
  readonly t: TranslateFunction
}

const OfferInfo = ({ item, t }: SearchResultCardProps): ReactElement => {
  if (item.cheapestOffer === null) {
    return (
      <p className="text-sm text-ink-muted" data-testid="search-result-no-offers">
        {t('catalog.search.no_offers')}
      </p>
    )
  }
  const offer = item.cheapestOffer
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm" data-testid="search-result-offer">
      <span className="font-medium text-ink" data-testid="search-result-price">
        {t('catalog.search.price', { price: formatSomoni(offer.priceDiram) })}
      </span>
      <span className="text-ink-muted">{offer.pharmacyName}</span>
      {offer.isStale ? (
        <span className="text-xs text-ink-muted" data-testid="search-result-stale">
          {t('map.pin.stale')}
        </span>
      ) : null}
    </div>
  )
}

export const SearchResultCard = ({ item, t }: SearchResultCardProps): ReactElement => (
  <article
    className="rounded-md border border-line bg-surface p-3"
    data-testid="search-result-card"
    data-medicine-id={item.medicineId}
  >
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-ink">{item.tradeName}</p>
        <p className="text-xs text-ink-muted">
          {item.dosageForm} {item.dosageStrength}
        </p>
        <p className="text-xs text-ink-muted">{item.innName}</p>
      </div>
      {item.isPrescriptionRequired ? (
        <span
          className="shrink-0 rounded bg-brand-primary/10 px-1.5 py-0.5 text-xs font-semibold text-brand-primary"
          data-testid="search-result-rx-badge"
        >
          {t('catalog.medicine.rx_badge')}
        </span>
      ) : null}
    </div>
    <div className="mt-2">
      <OfferInfo item={item} t={t} />
    </div>
  </article>
)
