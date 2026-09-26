/**
 * `medicine-card.spec.tsx` (DTJ-407, тест-план тикета, критерий приёмки 5).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PharmacyOfferRow } from '../pharmacy-offer-row/pharmacy-offer-row'
import { MedicineCard } from './medicine-card'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

const BASE_PROPS = {
  tradeName: 'Цитрамон',
  innName: 'Парацетамол+Кофеин+Аспирин',
  dosageForm: 'таблетки',
  dosageStrength: '500 мг',
  manufacturerName: 'ОАО «Фармленд»',
  priceDiram: 5000,
  controlCategory: 'none' as const,
  inStock: true,
  locale: 'ru' as const,
  t,
}

describe('MedicineCard — единая кликабельная область (критерий приёмки 5, тест-план DTJ-407)', () => {
  it('клик в любую точку карточки триггерит onClick', () => {
    const onClick = vi.fn()
    render(<MedicineCard {...BASE_PROPS} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Цитрамон' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('рендерится как <a href> вместо <button>, когда передан href', () => {
    render(<MedicineCard {...BASE_PROPS} href="/medicines/123" />)
    const link = screen.getByRole('link', { name: 'Цитрамон' })
    expect(link).toHaveAttribute('href', '/medicines/123')
  })

  it('клик по вложенной кнопке «В корзину» PharmacyOfferRow НЕ триггерит клик карточки (stopPropagation)', () => {
    const onCardClick = vi.fn()
    const onAddToCart = vi.fn()
    render(
      <MedicineCard {...BASE_PROPS} onClick={onCardClick}>
        <PharmacyOfferRow pharmacyName="Салом+" priceDiram={5000} inStock onAddToCart={onAddToCart} locale="ru" t={t} />
      </MedicineCard>,
    )
    fireEvent.click(screen.getByRole('button', { name: t('cart.add_item_cta') }))
    expect(onAddToCart).toHaveBeenCalledTimes(1)
    expect(onCardClick).not.toHaveBeenCalled()
  })
})

describe('MedicineCard — Rx-бейдж (SRS-CAT-056 п.2)', () => {
  it('рендерит Rx-бейдж, когда controlCategory !== "none"', () => {
    render(<MedicineCard {...BASE_PROPS} controlCategory="prescription_only" />)
    expect(screen.getByTestId('medicine-card-rx-badge')).toHaveTextContent(t('catalog.medicine.rx_badge'))
  })

  it('НЕ рендерит Rx-бейдж, когда controlCategory === "none"', () => {
    render(<MedicineCard {...BASE_PROPS} />)
    expect(screen.queryByTestId('medicine-card-rx-badge')).not.toBeInTheDocument()
  })
})

describe('MedicineCard — цена/остаток/расстояние', () => {
  it('рендерит цену через PriceTag', () => {
    render(<MedicineCard {...BASE_PROPS} />)
    expect(screen.getByText('50.00 сомони')).toBeInTheDocument()
  })

  it('рендерит индикатор отсутствия в наличии, когда inStock === false', () => {
    render(<MedicineCard {...BASE_PROPS} inStock={false} />)
    expect(screen.getByTestId('medicine-card-no-stock')).toHaveTextContent(t('catalog.search.no_offers'))
  })

  it('рендерит расстояние, когда передан distanceLabel', () => {
    render(<MedicineCard {...BASE_PROPS} distanceLabel="900 м" />)
    expect(screen.getByTestId('medicine-card-distance')).toHaveTextContent('900 м')
  })
})
