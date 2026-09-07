import type { ReactElement } from 'react'
import type { Locale, TranslateFunction } from '@dorutj/i18n'
import { Badge, Card, PriceTag } from '@dorutj/ui'
import type { AnalogItemDto } from '../api/use-analogs-query'

/**
 * `analog-card.tsx` (DTJ-104/431, `SRS-CAT-040`, `TC-CAT-016`).
 *
 * Одна карточка аналога — название, производитель, цена, Rx-бейдж. Чисто презентационный
 * компонент (без сети/состояния) — `t`/`locale` приходят пропом сверху (`ui/analogs-block.tsx`),
 * тот же приём, что `features/search/ui/search-result-card.tsx` (DTJ-193).
 *
 * DTJ-431: перенесено на `Card`+`PriceTag` (`@dorutj/ui`, DTJ-404/407) вместо ручной вёрстки и
 * ручного форматирования цены (`formatSavings`/`catalog.search.price`) — `PriceTag` сам вызывает
 * `formatMoney()` (единственный легальный способ печатать деньги, AGENTS.md §6).
 *
 * **Rx-бейдж — ПЕР-КАРТОЧЕЧНЫЙ.** `item.isPrescriptionRequired` берётся из ЭТОГО конкретного
 * аналога, не общего флага блока (список может содержать смесь Rx/OTC — `SRS-CAT-040`).
 *
 * Ключ `catalog.analogs.rx_required_badge` (не переиспользован уже существующий
 * `catalog.medicine.rx_badge` из `search-result-card.tsx`) — `SRS-CAT-040` фиксирует ДРУГОЙ,
 * специально выверенный текст («Требуется рецепт», не «По рецепту»); тексты дисклеймера/бейджей
 * блока аналогов проходят отдельную юридическую вычитку (`SRS-CAT-041`), совпадение по смыслу с
 * существующим ключом не даёт права смешивать версии текста.
 */

const RX_BADGE_I18N_KEY = 'catalog.analogs.rx_required_badge'

export interface AnalogCardProps {
  readonly item: AnalogItemDto
  readonly locale: Locale
  readonly t: TranslateFunction
}

export const AnalogCard = ({ item, locale, t }: AnalogCardProps): ReactElement => (
  <Card data-testid="analog-card" data-medicine-id={item.medicineId}>
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-semibold text-ink">{item.tradeName}</p>
        <p className="text-xs text-ink-muted">{item.manufacturerName}</p>
      </div>
      {item.isPrescriptionRequired ? (
        <Badge tone="warning" data-testid="analog-card-rx-badge">
          {t(RX_BADGE_I18N_KEY)}
        </Badge>
      ) : null}
    </div>
    <p className="mt-2 text-sm font-medium text-ink" data-testid="analog-card-price">
      <PriceTag amountDiram={item.cheapestOffer.priceDiram} locale={locale} />
    </p>
  </Card>
)
