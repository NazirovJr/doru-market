/**
 * `MedicineCard` (DTJ-407, `SRS-UX-002`/`SRS-UX-019`/`SRS-UX-021`) — карточка препарата списка
 * результатов поиска. Единая кликабельная область — `Card` (DTJ-404, `interactive`, переход по
 * `href`/`onClick`), не собственная кнопка/div-обёртка (переиспользование, правило 12 AGENTS.md).
 *
 * `controlCategory` — структурно совместим с `ControlCategoryPublic`
 * (`packages/contracts/src/catalog.ts`), НЕ импортируется оттуда: `packages/ui` не объявляет
 * `@dorutj/contracts` зависимостью (тот же приём, что `cursor-list/use-cursor-pagination.ts`,
 * отчёт DTJ-408, ДОПУЩЕНИЯ) — литеральный union здесь обязан остаться 1:1 с
 * `CONTROL_CATEGORY_VALUES_PUBLIC`, расхождение при последующем изменении контракта — риск,
 * который несёт потребитель (TS не свяжет два места без общей зависимости).
 *
 * Rx-бейдж переиспользует СУЩЕСТВУЮЩИЙ ключ `catalog.medicine.rx_badge` («По рецепту»,
 * `apps/web/src/features/search/ui/search-result-card.tsx`, DTJ-193) — второй ключ с идентичным
 * смыслом не заводим (правило Ж12 тикета/AGENTS.md правило 12).
 *
 * `distanceLabel`/`inStock` — уже ГОТОВЫЕ данные потребителя (форматирование расстояния — вне
 * `packages/i18n`: пакет не экспортирует `formatDistance`, в репозитории такой утилиты вообще нет
 * на момент этого тикета — заводить её здесь означало бы бизнес-логику форматирования дистанции
 * внутри чисто витринного компонента, что прямо запрещено §DoD тикета; `distanceLabel` — просто
 * уже локализованная строка, `MedicineCard` её не вычисляет). Остаток — булев индикатор
 * `inStock`, при `false` рендерит существующий ключ `catalog.search.no_offers` («Нет в наличии»,
 * тот же ключ, что `search-result-card.tsx` — не дублируем).
 *
 * `children` — опциональный слот под карточкой (например список `PharmacyOfferRow`, критерий
 * приёмки 5 тикета): вложенная кнопка внутри слота обязана сама останавливать всплытие клика
 * (`stopPropagation`, см. `pharmacy-offer-row.tsx`) — это ответственность вложенного компонента,
 * не `MedicineCard`.
 */
import { type ReactElement, type ReactNode } from 'react'
import { type Locale, type TranslateFunction } from '@dorutj/i18n'
import { Card } from '../card/card'
import { PriceTag } from '../price-tag/price-tag'

/** 1:1 с `ControlCategoryPublic` (`packages/contracts/src/catalog.ts`) — см. JSDoc модуля. */
export type MedicineCardControlCategory = 'none' | 'prescription_only' | 'potent' | 'psychotropic' | 'narcotic'

export interface MedicineCardProps {
  readonly tradeName: string
  readonly innName: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly manufacturerName: string
  readonly priceDiram: number
  readonly controlCategory: MedicineCardControlCategory
  readonly inStock: boolean
  /** Уже отформатированная строка расстояния («1.2 км») — см. JSDoc модуля. */
  readonly distanceLabel?: string
  readonly locale: Locale
  readonly t: TranslateFunction
  readonly onClick?: () => void
  /** Если задан — карточка рендерится как `<a href>` (см. `Card`). */
  readonly href?: string
  /** Слот под ценой/остатком — например список `PharmacyOfferRow` (критерий приёмки 5). */
  readonly children?: ReactNode
}

export const MedicineCard = ({
  tradeName,
  innName,
  dosageForm,
  dosageStrength,
  manufacturerName,
  priceDiram,
  controlCategory,
  inStock,
  distanceLabel,
  locale,
  t,
  onClick,
  href,
  children,
}: MedicineCardProps): ReactElement => {
  // `exactOptionalPropertyTypes` — `Card.href`/`Card.onClick` не принимают `undefined` явно,
  // только отсутствие ключа (`CardInteractiveProps` — опциональные поля), поэтому пропы
  // собираются условно, а не передаются как `href={href}`/`onClick={onClick}` (это было бы
  // `href: undefined`/`onClick: undefined` — другой тип с точки зрения TS).
  const cardHrefProps = href === undefined ? {} : { href }
  const cardClickProps = onClick === undefined ? {} : { onClick }

  return (
    <Card interactive {...cardHrefProps} {...cardClickProps} aria-label={tradeName}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <div>
            <p style={{ margin: 0, fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--brand-text)' }}>
              {tradeName}
            </p>
            <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--brand-text-muted)' }}>
              {innName} · {dosageForm} {dosageStrength} · {manufacturerName}
            </p>
          </div>
          {controlCategory !== 'none' && (
            <span
              data-testid="medicine-card-rx-badge"
              style={{
                flexShrink: 0,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--brand-primary)',
                color: 'var(--brand-surface)',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 'var(--font-weight-semibold)',
                padding: '2px var(--space-2)',
              }}
            >
              {t('catalog.medicine.rx_badge')}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <PriceTag amountDiram={priceDiram} locale={locale} />
          {distanceLabel !== undefined && (
            <span data-testid="medicine-card-distance" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--brand-text-muted)' }}>
              {distanceLabel}
            </span>
          )}
        </div>

        {!inStock && (
          <p data-testid="medicine-card-no-stock" style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--brand-text-muted)' }}>
            {t('catalog.search.no_offers')}
          </p>
        )}

        {children}
      </div>
    </Card>
  )
}
