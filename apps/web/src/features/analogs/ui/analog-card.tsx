import type { ReactElement } from 'react'
import { Link } from 'react-router'
import { Badge, Button, PriceTag } from '@dorutj/ui'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import type { AnalogItemDto } from '../api/use-analogs-query'

// Rx-бейдж пер-карточечный: в списке аналогов смесь Rx и OTC. Ключ свой — текст проходит отдельную юр. вычитку.
const RX_BADGE_I18N_KEY = 'catalog.analogs.rx_required_badge'

export interface AnalogCardProps {
  readonly item: AnalogItemDto
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly onAddToCart: (medicineId: string, pharmacyId: string) => void
}

export const AnalogCard = ({ item, locale, t, onAddToCart }: AnalogCardProps): ReactElement => (
  <article
    data-testid="analog-card"
    data-medicine-id={item.medicineId}
    className="rounded-md border border-line bg-surface p-3"
  >
    <div className="flex items-start justify-between gap-2">
      <div>
        <Link to={`/medicines/${item.medicineId}`} className="text-sm font-semibold text-ink underline">
          {item.tradeName}
        </Link>
        <p className="text-xs text-ink-muted">{item.manufacturerName}</p>
      </div>
      {item.isPrescriptionRequired ? (
        <span data-testid="analog-card-rx-badge" className="shrink-0">
          <Badge tone="warning">{t(RX_BADGE_I18N_KEY)}</Badge>
        </span>
      ) : null}
    </div>
    <div className="mt-2 flex items-center justify-between gap-2" data-testid="analog-card-price">
      <PriceTag amountDiram={item.cheapestOffer.priceDiram} locale={locale} />
      <Button
        variant="secondary"
        onClick={() => {
          onAddToCart(item.medicineId, item.cheapestOffer.pharmacyId)
        }}
      >
        {t('cart.add_item_cta')}
      </Button>
    </div>
  </article>
)
