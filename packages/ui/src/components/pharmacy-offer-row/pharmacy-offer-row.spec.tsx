/**
 * `pharmacy-offer-row.spec.tsx` (DTJ-407, тест-план тикета, критерий приёмки 4).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PharmacyOfferRow } from './pharmacy-offer-row'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

describe('PharmacyOfferRow — isStale (критерий приёмки 4, тест-план DTJ-407)', () => {
  it('содержит интерполированное "12 мин назад" рядом с иконкой (не только цвет)', () => {
    render(<PharmacyOfferRow pharmacyName="Салом+" priceDiram={5000} inStock isStale minutesAgo={12} locale="ru" t={t} />)
    const stale = screen.getByTestId('pharmacy-offer-row-stale')
    expect(stale).toHaveTextContent('12 мин назад')
    expect(stale.querySelector('svg')).not.toBeNull()
  })

  it('не рендерит индикатор устаревания, когда isStale не задан', () => {
    render(<PharmacyOfferRow pharmacyName="Салом+" priceDiram={5000} inStock locale="ru" t={t} />)
    expect(screen.queryByTestId('pharmacy-offer-row-stale')).not.toBeInTheDocument()
  })
})

describe('PharmacyOfferRow — кнопка «В корзину» и stopPropagation (критерий приёмки 5)', () => {
  it('вызывает onAddToCart при клике на кнопку', () => {
    const onAddToCart = vi.fn()
    render(<PharmacyOfferRow pharmacyName="Салом+" priceDiram={5000} inStock onAddToCart={onAddToCart} locale="ru" t={t} />)
    fireEvent.click(screen.getByRole('button', { name: t('cart.add_item_cta') }))
    expect(onAddToCart).toHaveBeenCalledTimes(1)
  })

  it('останавливает всплытие клика — обёртка-обработчик снаружи не срабатывает', () => {
    const outerHandler = vi.fn()
    const onAddToCart = vi.fn()
    render(
      <div onClick={outerHandler}>
        <PharmacyOfferRow pharmacyName="Салом+" priceDiram={5000} inStock onAddToCart={onAddToCart} locale="ru" t={t} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: t('cart.add_item_cta') }))
    expect(onAddToCart).toHaveBeenCalledTimes(1)
    expect(outerHandler).not.toHaveBeenCalled()
  })

  it('отключает кнопку, когда нет в наличии', () => {
    render(<PharmacyOfferRow pharmacyName="Салом+" priceDiram={5000} inStock={false} locale="ru" t={t} />)
    expect(screen.getByTestId('pharmacy-offer-row-no-stock')).toHaveTextContent(t('catalog.search.no_offers'))
    expect(screen.getByRole('button', { name: t('cart.add_item_cta') })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('PharmacyOfferRow — цена/расстояние', () => {
  it('рендерит цену через PriceTag и опциональное расстояние', () => {
    render(<PharmacyOfferRow pharmacyName="Салом+" priceDiram={5000} inStock distanceLabel="1.2 км" locale="ru" t={t} />)
    expect(screen.getByText('50.00 сомони')).toBeInTheDocument()
    expect(screen.getByText('1.2 км')).toBeInTheDocument()
  })
})
