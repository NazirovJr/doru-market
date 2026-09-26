/**
 * `price-tag.spec.tsx` (DTJ-407, тест-план тикета).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PriceTag } from './price-tag'

afterEach(() => {
  cleanup()
})

describe('PriceTag — форматирование через formatMoney (тест-план DTJ-407)', () => {
  it('рендерит сумму в сомони через formatMoney для ru', () => {
    render(<PriceTag amountDiram={12050} locale="ru" />)
    expect(screen.getByTestId('price-tag-current')).toHaveTextContent('120.50 сомони')
  })

  it('рендерит сумму в сомони через formatMoney для tj', () => {
    render(<PriceTag amountDiram={12050} locale="tj" />)
    expect(screen.getByTestId('price-tag-current')).toHaveTextContent('120.50 сомонӣ')
  })

  it('рендерит сумму в сомони через formatMoney для en (без суффикса валюты)', () => {
    render(<PriceTag amountDiram={12050} locale="en" />)
    expect(screen.getByTestId('price-tag-current')).toHaveTextContent('120.50')
  })

  it('не рендерит зачёркнутую цену, когда previousAmountDiram не задан', () => {
    render(<PriceTag amountDiram={12050} locale="ru" />)
    expect(screen.queryByTestId('price-tag-previous')).not.toBeInTheDocument()
  })

  it('рендерит зачёркнутую предыдущую цену рядом с новой через <s> (пара «было/стало»)', () => {
    render(<PriceTag amountDiram={12050} previousAmountDiram={15000} locale="ru" />)
    const previous = screen.getByTestId('price-tag-previous')
    expect(previous.tagName).toBe('S')
    expect(previous).toHaveTextContent('150.00 сомони')
    expect(screen.getByTestId('price-tag-current')).toHaveTextContent('120.50 сомони')
  })

  it('форматирует нулевую и целочисленную сумму без дробной части корректно', () => {
    render(<PriceTag amountDiram={0} locale="ru" />)
    expect(screen.getByTestId('price-tag-current')).toHaveTextContent('0.00 сомони')
  })
})
