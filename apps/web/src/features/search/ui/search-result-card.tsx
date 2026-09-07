/**
 * `search-result-card.tsx` (DTJ-193/431, `SRS-CAT-011`/`056`).
 *
 * Одна карточка результата поиска. Чисто презентационный компонент — состояние (загрузка/
 * пагинация/ошибки) держит `search-results-page.tsx`.
 *
 * DTJ-431: перенесено на `MedicineCard` (`@dorutj/ui`, DTJ-407) — цена форматируется через
 * `PriceTag`/`formatMoney()` внутри `MedicineCard`, локальный `formatSomoni()`
 * (`(priceDiram/100).toFixed(2)`) удалён (AGENTS.md §6 — деньги только через `formatMoney`).
 *
 * `tradeName`/`dosageForm`/`dosageStrength`/`innName`/`pharmacyName` — ДАННЫЕ с бэкенда, не
 * UI-строки интерфейса, поэтому не проходят через `useT()`.
 *
 * `MedicineCard.onClick` ОБЯЗАТЕЛЕН (вся площадь карточки кликабельна, DTJ-407 п.4) — переход на
 * `/medicines/:id` (стаб-экран, DTJ-104), навигации по клику раньше не было — минимальное
 * разумное поведение, требуемое контрактом общего компонента, а не самостоятельная фича.
 *
 * `locale` компонент резолвит сам через `useLocale()` (не проп) — `search-results-page.tsx`
 * (вне `files_owned` этого тикета) не передавал `locale` в `SearchResultCard`, а `MedicineCard`
 * требует его для `PriceTag`; `useLocale()` — глобальный контекст (`main.tsx`), доступен без
 * правки родителя.
 */
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import type { TranslateFunction } from '@dorutj/i18n'
import { MedicineCard } from '@dorutj/ui'
import type { SearchResultItemDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'

export interface SearchResultCardProps {
  readonly item: SearchResultItemDto
  readonly t: TranslateFunction
}

export const SearchResultCard = ({ item, t }: SearchResultCardProps): ReactElement => {
  const navigate = useNavigate()
  const { locale } = useLocale()

  const handleClick = (): void => {
    void navigate(`/medicines/${item.medicineId}`)
  }

  if (item.cheapestOffer === null) {
    return (
      <article
        className="rounded-md border border-line bg-surface p-3"
        data-testid="search-result-card"
        data-medicine-id={item.medicineId}
      >
        <p className="text-sm font-semibold text-ink">{item.tradeName}</p>
        <p className="mt-2 text-sm text-ink-muted" data-testid="search-result-no-offers">
          {t('catalog.search.no_offers')}
        </p>
      </article>
    )
  }

  const offer = item.cheapestOffer
  const metaLabel = `${item.dosageForm} ${item.dosageStrength}`.trim()

  return (
    <div data-testid="search-result-card" data-medicine-id={item.medicineId}>
      <MedicineCard
        tradeName={item.tradeName}
        innName={item.innName}
        dosageForm={metaLabel}
        priceDiram={offer.priceDiram}
        locale={locale}
        distanceLabel={offer.pharmacyName}
        stockLabel={
          offer.isStale ? (
            <span data-testid="search-result-stale">{t('map.pin.stale')}</span>
          ) : undefined
        }
        controlCategory={item.isPrescriptionRequired ? 'prescription_only' : 'none'}
        rxBadgeLabel={
          item.isPrescriptionRequired ? (
            <span data-testid="search-result-rx-badge">{t('catalog.medicine.rx_badge')}</span>
          ) : undefined
        }
        onClick={handleClick}
      />
    </div>
  )
}
