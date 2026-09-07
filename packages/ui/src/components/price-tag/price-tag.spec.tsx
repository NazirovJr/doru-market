import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { PriceTag } from './price-tag.js'

describe('PriceTag — форматирование через formatMoney (DTJ-402), 3 локали', () => {
  it('ru — целые дирамы → сомони с запятой и суффиксом', () => {
    render(<PriceTag amountDiram={12050} locale="ru" />)
    expect(screen.getByText('120,50 сомони')).toBeInTheDocument()
  })

  it('tj — тот же алгоритм, другой суффикс', () => {
    render(<PriceTag amountDiram={12050} locale="tj" />)
    expect(screen.getByText('120,50 сомонӣ')).toBeInTheDocument()
  })

  it('en — точка как разделитель, пустой суффикс (нет ISO-кода)', () => {
    render(<PriceTag amountDiram={12050} locale="en" />)
    expect(screen.getByText('120.50')).toBeInTheDocument()
  })

  it('не округляет до целых сомони — 1 дирам всё ещё виден как .01', () => {
    render(<PriceTag amountDiram={1} locale="en" />)
    expect(screen.getByText('0.01')).toBeInTheDocument()
  })
})

describe('PriceTag — strikethrough (пара «было/стало», тест-план DTJ-407)', () => {
  it('strikethrough=false — обычный <span>, без зачёркивания', () => {
    const { container } = render(<PriceTag amountDiram={5000} locale="ru" />)
    expect(container.querySelector('s')).not.toBeInTheDocument()
    expect(container.querySelector('span.ui-price-tag')).toBeInTheDocument()
  })

  it('strikethrough=true — семантический <s>, класс-модификатор применён', () => {
    const { container } = render(<PriceTag amountDiram={5000} locale="ru" strikethrough />)
    const el = container.querySelector('s.ui-price-tag--strikethrough')
    expect(el).toBeInTheDocument()
    expect(el).toHaveTextContent('50,00 сомони')
  })

  it('рендер пары «было/стало» рядом — обе цены присутствуют одновременно в DOM', () => {
    render(
      <div>
        <PriceTag amountDiram={10000} locale="ru" strikethrough />
        <PriceTag amountDiram={7500} locale="ru" />
      </div>,
    )
    expect(screen.getByText('100,00 сомони').tagName).toBe('S')
    expect(screen.getByText('75,00 сомони').tagName).toBe('SPAN')
  })
})

describe('PriceTag — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<PriceTag amountDiram={12050} locale="ru" />)
    expect(axeResults).toHaveNoViolations()
  })
})
