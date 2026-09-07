import { render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { PharmacyOfferRow } from './pharmacy-offer-row.js'

const { t } = useT('ru')

const baseProps = {
  pharmacyName: 'Аптека №1',
  priceDiram: 12550,
  locale: 'ru' as const,
  t,
  ctaLabel: 'В корзину',
}

describe('PharmacyOfferRow — isStale рендерит иконку + текст (тест-план DTJ-407 п.4/AC4)', () => {
  it('isStale=false — нет индикатора устаревания в DOM', () => {
    const { container } = render(<PharmacyOfferRow {...baseProps} />)
    expect(container.querySelector('.ui-pharmacy-offer-row__stale')).not.toBeInTheDocument()
  })

  it('isStale minutesAgo=12 — текст содержит интерполированное «12 мин назад», рядом иконка (не только цвет)', () => {
    const { container } = render(<PharmacyOfferRow {...baseProps} isStale minutesAgo={12} />)
    expect(screen.getByText('Данные могут быть неактуальны (обновлено 12 мин назад).')).toBeInTheDocument()
    expect(container.querySelector('.ui-pharmacy-offer-row__stale svg')).toBeInTheDocument()
  })
})

describe('PharmacyOfferRow — цена через PriceTag/formatMoney', () => {
  it('рендерит цену, отформатированную formatMoney', () => {
    render(<PharmacyOfferRow {...baseProps} />)
    expect(screen.getByText('125,50 сомони')).toBeInTheDocument()
  })
})

describe('PharmacyOfferRow — опциональные поля рендерятся только когда переданы', () => {
  it('без distanceLabel/stockLabel — секции отсутствуют', () => {
    const { container } = render(<PharmacyOfferRow {...baseProps} />)
    expect(container.querySelector('.ui-pharmacy-offer-row__distance')).not.toBeInTheDocument()
    expect(container.querySelector('.ui-pharmacy-offer-row__stock')).not.toBeInTheDocument()
  })

  it('с distanceLabel/stockLabel — обе секции рендерятся', () => {
    const { container } = render(<PharmacyOfferRow {...baseProps} distanceLabel="500 м" stockLabel="В наличии" />)
    expect(container.querySelector('.ui-pharmacy-offer-row__distance')).toHaveTextContent('500 м')
    expect(container.querySelector('.ui-pharmacy-offer-row__stock')).toHaveTextContent('В наличии')
  })

  it('isStale без minutesAgo — интерполирует 0 (defensive fallback), не падает', () => {
    render(<PharmacyOfferRow {...baseProps} isStale />)
    expect(screen.getByText('Данные могут быть неактуальны (обновлено 0 мин назад).')).toBeInTheDocument()
  })
})

describe('PharmacyOfferRow — кнопка «В корзину» останавливает всплытие клика (AC5)', () => {
  it('клик по кнопке НЕ достигает обработчика клика родительского контейнера', () => {
    const onAddToCart = vi.fn()
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <PharmacyOfferRow {...baseProps} onAddToCart={onAddToCart} />
      </div>,
    )

    screen.getByRole('button', { name: 'В корзину' }).click()

    expect(onAddToCart).toHaveBeenCalledTimes(1)
    expect(onParentClick).not.toHaveBeenCalled()
  })
})

describe('PharmacyOfferRow — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<PharmacyOfferRow {...baseProps} isStale minutesAgo={5} />)
    expect(axeResults).toHaveNoViolations()
  })
})
