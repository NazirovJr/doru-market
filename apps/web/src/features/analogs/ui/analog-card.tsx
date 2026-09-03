import type { ReactElement } from 'react'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import type { AnalogItemDto } from '../api/use-analogs-query'
import { formatSavings } from '../model/format-savings'

/**
 * `analog-card.tsx` (DTJ-104, `SRS-CAT-040`, `TC-CAT-016`).
 *
 * Одна карточка аналога — название, производитель, цена, Rx-бейдж. Чисто презентационный
 * компонент (без сети/состояния) — `t`/`locale` приходят пропом сверху (`ui/analogs-block.tsx`),
 * тот же приём, что `features/search/ui/search-result-card.tsx` (DTJ-193).
 *
 * **Rx-бейдж — ПЕР-КАРТОЧЕЧНЫЙ.** `item.isPrescriptionRequired` берётся из ЭТОГО конкретного
 * аналога, не общего флага блока (список может содержать смесь Rx/OTC — `SRS-CAT-040`). Рядом с
 * конкретной карточкой, НЕ общий баннер над списком.
 *
 * Ключ `catalog.analogs.rx_required_badge` (не переиспользован уже существующий
 * `catalog.medicine.rx_badge` из `search-result-card.tsx`) — `SRS-CAT-040` фиксирует ДРУГОЙ,
 * специально выверенный текст («Требуется рецепт», не «По рецепту»); тексты дисклеймера/бейджей
 * блока аналогов проходят отдельную юридическую вычитку (`SRS-CAT-041`), совпадение по смыслу с
 * существующим ключом не даёт права смешивать версии текста.
 *
 * Цена карточки переиспользует `catalog.search.price` (СУЩЕСТВУЮЩИЙ ключ, тот же смысл «цена +
 * сомони», что и в результатах поиска) — второй ключ с идентичным смыслом не заводим (Ж12).
 */

const RX_BADGE_I18N_KEY = 'catalog.analogs.rx_required_badge'
const PRICE_I18N_KEY = 'catalog.search.price'

export interface AnalogCardProps {
  readonly item: AnalogItemDto
  readonly locale: Locale
  readonly t: TranslateFunction
}

export const AnalogCard = ({ item, locale, t }: AnalogCardProps): ReactElement => (
  <article
    data-testid="analog-card"
    data-medicine-id={item.medicineId}
    className="rounded-md border border-line bg-surface p-3"
  >
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-ink">{item.tradeName}</p>
        <p className="text-xs text-ink-muted">{item.manufacturerName}</p>
      </div>
      {item.isPrescriptionRequired ? (
        <span
          data-testid="analog-card-rx-badge"
          className="shrink-0 rounded bg-brand-primary/10 px-1.5 py-0.5 text-xs font-semibold text-brand-primary"
        >
          {t(RX_BADGE_I18N_KEY)}
        </span>
      ) : null}
    </div>
    <p className="mt-2 text-sm font-medium text-ink" data-testid="analog-card-price">
      {t(PRICE_I18N_KEY, { price: formatSavings(item.cheapestOffer.priceDiram, locale) })}
    </p>
  </article>
)
