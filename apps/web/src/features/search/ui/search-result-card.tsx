import type { ReactElement } from 'react'
import { MedicineCard, PharmacyOfferRow } from '@dorutj/ui'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import type { PharmacyOfferDto, SearchResultItemDto } from '@dorutj/contracts'
import { minutesSince } from '@/shared/lib/minutes-since'
import { formatDistanceLabel } from '../model/offer-view'

export interface SearchResultCardProps {
  readonly item: SearchResultItemDto
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly dimmed: boolean
  readonly onOpen: (medicineId: string) => void
  readonly onAddToCart: (medicineId: string, pharmacyId: string) => void
}

interface OfferProps {
  readonly medicineId: string
  readonly offer: PharmacyOfferDto
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly onAddToCart: SearchResultCardProps['onAddToCart']
}

// Строка предложения — соседний узел карточки, а не её потомок: кнопка внутри кнопки-карточки невалидна для a11y.
const OfferRow = ({ medicineId, offer, locale, t, onAddToCart }: OfferProps): ReactElement => {
  const distanceLabel = formatDistanceLabel(offer.distanceMeters, locale, t)
  return (
    <PharmacyOfferRow
      pharmacyName={offer.pharmacyName}
      priceDiram={offer.priceDiram}
      inStock={offer.stockQuantity > 0}
      isStale={offer.isStale}
      minutesAgo={minutesSince(offer.lastSyncedAt, Date.now())}
      locale={locale}
      t={t}
      onAddToCart={() => {
        onAddToCart(medicineId, offer.pharmacyId)
      }}
      {...(distanceLabel === undefined ? {} : { distanceLabel })}
    />
  )
}

export const SearchResultCard = ({ item, locale, t, dimmed, onOpen, onAddToCart }: SearchResultCardProps): ReactElement => (
  <article
    data-testid="search-result-card"
    data-medicine-id={item.medicineId}
    className={dimmed ? 'flex flex-col gap-1 opacity-60' : 'flex flex-col gap-1'}
  >
    <MedicineCard
      tradeName={item.tradeName}
      innName={item.innName}
      dosageForm={item.dosageForm}
      dosageStrength={item.dosageStrength}
      controlCategory={item.isPrescriptionRequired ? 'prescription_only' : 'none'}
      inStock={item.cheapestOffer !== null}
      locale={locale}
      t={t}
      onClick={() => {
        onOpen(item.medicineId)
      }}
    />
    {item.cheapestOffer === null ? null : (
      <OfferRow medicineId={item.medicineId} offer={item.cheapestOffer} locale={locale} t={t} onAddToCart={onAddToCart} />
    )}
  </article>
)
