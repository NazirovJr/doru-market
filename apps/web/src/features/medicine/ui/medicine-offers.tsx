import type { ReactElement } from 'react'
import { PharmacyOfferRow } from '@dorutj/ui'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import type { PharmacyMapPinDto } from '@dorutj/contracts'
import { minutesSince } from '@/shared/lib/minutes-since'

export interface MedicineOffersProps {
  readonly medicineId: string
  readonly pins: readonly PharmacyMapPinDto[]
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly onAddToCart: (medicineId: string, pharmacyId: string) => void
}

type PinWithOffer = PharmacyMapPinDto & { readonly offer: NonNullable<PharmacyMapPinDto['offer']> }

const hasOffer = (pin: PharmacyMapPinDto): pin is PinWithOffer => pin.offer !== null

const byPriceAsc = (a: PinWithOffer, b: PinWithOffer): number => a.offer.priceDiram - b.offer.priceDiram

export const MedicineOffers = ({ medicineId, pins, locale, t, onAddToCart }: MedicineOffersProps): ReactElement => {
  const offers = pins.filter(hasOffer).sort(byPriceAsc)
  return (
    <section data-testid="medicine-offers" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">{t('catalog.medicine.offers_title')}</h2>
      {offers.length === 0 ? (
        <p role="status" data-testid="medicine-offers-empty" className="text-sm text-ink-muted">
          {t('catalog.medicine.offers_empty')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {offers.map((pin) => (
            <li key={pin.pharmacyId}>
              <PharmacyOfferRow
                pharmacyName={pin.name}
                priceDiram={pin.offer.priceDiram}
                inStock={pin.offer.stockQuantity > 0}
                isStale={pin.offer.isStale}
                minutesAgo={minutesSince(pin.offer.lastSyncedAt, Date.now())}
                locale={locale}
                t={t}
                onAddToCart={() => {
                  onAddToCart(medicineId, pin.pharmacyId)
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
