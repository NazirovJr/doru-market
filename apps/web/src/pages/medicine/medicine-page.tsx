import { useMemo, type ReactElement } from 'react'
import { useParams } from 'react-router'
import { ErrorState, Skeleton } from '@dorutj/ui'
import { useT, type Locale, type TranslateFunction } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useUserGeo } from '@/shared/geo/use-user-geo'
import { AnalogsBlock } from '@/features/analogs/ui/analogs-block'
import { usePharmacyMapPins } from '@/features/pharmacy-map/api/use-pharmacy-map-pins'
import { useAddToCart, type AddToCart } from '@/features/cart/model/use-add-to-cart'
import { useMedicineDetail } from '@/features/medicine/api/use-medicine-detail'
import { buildOffersBbox } from '@/features/medicine/model/offers-bbox'
import { MedicineHeader } from '@/features/medicine/ui/medicine-header'
import { MedicineOffers } from '@/features/medicine/ui/medicine-offers'
import { NearbyControl } from '@/features/search/ui/nearby-control'

const HTTP_STATUS_NOT_FOUND = 404

interface OffersSectionProps {
  readonly medicineId: string
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly onAddToCart: AddToCart
}

const OffersSection = ({ medicineId, locale, t, onAddToCart }: OffersSectionProps): ReactElement => {
  const geo = useUserGeo()
  const bbox = useMemo(() => buildOffersBbox(geo.coords), [geo.coords])
  const pins = usePharmacyMapPins({ bbox, medicineId })

  return (
    <div className="flex flex-col gap-3">
      <NearbyControl status={geo.status} onRequest={geo.request} t={t} />
      {pins.isPending ? <Skeleton variant="row" /> : null}
      {pins.isError ? (
        <ErrorState
          t={t}
          titleKey="ux.error.generic_500"
          variant="inline"
          onRetry={() => {
            void pins.refetch()
          }}
        />
      ) : null}
      {pins.isSuccess ? (
        <MedicineOffers medicineId={medicineId} pins={pins.data} locale={locale} t={t} onAddToCart={onAddToCart} />
      ) : null}
      <AnalogsBlock
        medicineId={medicineId}
        geo={geo.coords ?? undefined}
        onAddToCart={onAddToCart}
      />
    </div>
  )
}

const MedicinePage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const { id } = useParams<{ id: string }>()
  const medicineId = id ?? ''
  const detail = useMedicineDetail(medicineId)
  const addToCart = useAddToCart()

  if (medicineId.length === 0 || detail.isError) {
    const notFound = medicineId.length > 0 && detail.error?.status === HTTP_STATUS_NOT_FOUND
    return (
      <p role="alert" data-testid="medicine-page-error" className="text-sm text-ink">
        {notFound ? t('catalog.medicine.not_found') : t('ux.error.generic_500')}
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-4" data-testid="medicine-page">
      {detail.isPending ? <Skeleton variant="card" /> : <MedicineHeader medicine={detail.data} t={t} />}
      {detail.isPending ? null : (
        <OffersSection medicineId={medicineId} locale={locale} t={t} onAddToCart={addToCart} />
      )}
    </section>
  )
}

export default MedicinePage
