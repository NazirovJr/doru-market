import { render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { PharmacyOfferRow } from '../pharmacy-offer-row/pharmacy-offer-row.js'
import { MedicineCard } from './medicine-card.js'

const { t } = useT('ru')

const baseProps = {
  tradeName: 'Каптоприл',
  innName: 'Captopril',
  dosageForm: 'таблетки',
  manufacturerName: 'Pharmstandard',
  priceDiram: 5000,
  locale: 'ru' as const,
  controlCategory: 'none' as const,
}

describe('MedicineCard — единая кликабельная область (AC5)', () => {
  it('клик по заголовку триггерит onClick карточки', () => {
    const onClick = vi.fn()
    render(<MedicineCard {...baseProps} onClick={onClick} />)
    screen.getByText('Каптоприл').click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('клик по любой другой точке карточки (например, производителю) — тот же onClick, нет мёртвых зон', () => {
    const onClick = vi.fn()
    render(<MedicineCard {...baseProps} onClick={onClick} />)
    screen.getByText(/Pharmstandard/).click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('рендерится как interactive Card — доступен клавиатуре (роль button)', () => {
    render(<MedicineCard {...baseProps} onClick={vi.fn()} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})

describe('MedicineCard — вложенная кнопка «В корзину» PharmacyOfferRow не триггерит переход карточки (AC5)', () => {
  it('клик по вложенной кнопке вызывает её обработчик, НЕ onClick карточки', () => {
    const onCardClick = vi.fn()
    const onAddToCart = vi.fn()
    render(
      <MedicineCard {...baseProps} onClick={onCardClick}>
        <PharmacyOfferRow pharmacyName="Аптека №1" priceDiram={5000} locale="ru" t={t} ctaLabel="В корзину" onAddToCart={onAddToCart} />
      </MedicineCard>,
    )

    screen.getByRole('button', { name: 'В корзину' }).click()

    expect(onAddToCart).toHaveBeenCalledTimes(1)
    expect(onCardClick).not.toHaveBeenCalled()
  })
})

describe('MedicineCard — Rx-бейдж только при controlCategory !== "none"', () => {
  it('controlCategory="none" — бейдж не рендерится, даже если передан rxBadgeLabel', () => {
    render(<MedicineCard {...baseProps} rxBadgeLabel="Требуется рецепт" onClick={vi.fn()} />)
    expect(screen.queryByText('Требуется рецепт')).not.toBeInTheDocument()
  })

  it('controlCategory="potent" + rxBadgeLabel — бейдж рендерится', () => {
    render(<MedicineCard {...baseProps} controlCategory="potent" rxBadgeLabel="Требуется рецепт" onClick={vi.fn()} />)
    expect(screen.getByText('Требуется рецепт')).toBeInTheDocument()
  })
})

describe('MedicineCard — опциональные поля рендерятся только когда переданы', () => {
  it('без innName/dosageForm/manufacturerName/distanceLabel/stockLabel — секции просто отсутствуют, без ошибок', () => {
    const { container } = render(
      <MedicineCard tradeName="Каптоприл" priceDiram={5000} locale="ru" controlCategory="none" onClick={vi.fn()} />,
    )
    expect(container.querySelector('.ui-medicine-card__inn')).not.toBeInTheDocument()
    expect(container.querySelector('.ui-medicine-card__meta')).not.toBeInTheDocument()
    expect(container.querySelector('.ui-medicine-card__distance')).not.toBeInTheDocument()
    expect(container.querySelector('.ui-medicine-card__stock')).not.toBeInTheDocument()
  })

  it('с distanceLabel/stockLabel — обе секции рендерятся', () => {
    const { container } = render(
      <MedicineCard {...baseProps} distanceLabel="500 м" stockLabel="В наличии" onClick={vi.fn()} />,
    )
    expect(container.querySelector('.ui-medicine-card__distance')).toHaveTextContent('500 м')
    expect(container.querySelector('.ui-medicine-card__stock')).toHaveTextContent('В наличии')
  })

  it('только dosageForm без manufacturerName — метастрока не пуста (частичное заполнение)', () => {
    const { container } = render(
      <MedicineCard
        tradeName="Каптоприл"
        dosageForm="таблетки"
        priceDiram={5000}
        locale="ru"
        controlCategory="none"
        onClick={vi.fn()}
      />,
    )
    expect(container.querySelector('.ui-medicine-card__meta')).toHaveTextContent('таблетки')
  })
})

describe('MedicineCard — цена через PriceTag/formatMoney', () => {
  it('рендерит цену карточки', () => {
    render(<MedicineCard {...baseProps} onClick={vi.fn()} />)
    expect(screen.getByText('50,00 сомони')).toBeInTheDocument()
  })
})

describe('MedicineCard — доступность', () => {
  it('ноль critical/serious a11y-нарушений (без вложенной кнопки)', async () => {
    const { axeResults } = await renderWithA11yCheck(<MedicineCard {...baseProps} onClick={vi.fn()} />)
    expect(axeResults).toHaveNoViolations()
  })
})
