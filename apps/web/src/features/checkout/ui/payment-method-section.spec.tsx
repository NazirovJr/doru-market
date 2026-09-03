import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { PaymentMethodSection } from './payment-method-section'

const { t } = useT('ru')

describe('PaymentMethodSection (DTJ-235, AC4)', () => {
  it('1. cash_courier — единственный активный (enabled), выбран по умолчанию', () => {
    render(<PaymentMethodSection selected="cash_courier" onSelect={vi.fn()} t={t} />)
    expect(screen.getByTestId('checkout-payment-method-cash_courier')).not.toBeDisabled()
    expect(screen.getByTestId('checkout-payment-method-cash_courier')).toHaveAttribute('aria-checked', 'true')
  })

  it('2. dc_next и alif_mobi — задизейблены с бейджем «Скоро»', () => {
    render(<PaymentMethodSection selected="cash_courier" onSelect={vi.fn()} t={t} />)
    expect(screen.getByTestId('checkout-payment-method-dc_next')).toBeDisabled()
    expect(screen.getByTestId('checkout-payment-method-alif_mobi')).toBeDisabled()
    expect(screen.getByTestId('checkout-payment-method-dc_next-badge')).toHaveTextContent('Скоро')
    expect(screen.getByTestId('checkout-payment-method-alif_mobi-badge')).toHaveTextContent('Скоро')
  })

  it('3. клик по задизейбленному способу оплаты ничего не отправляет (onSelect не вызывается)', () => {
    const onSelect = vi.fn()
    render(<PaymentMethodSection selected="cash_courier" onSelect={onSelect} t={t} />)
    fireEvent.click(screen.getByTestId('checkout-payment-method-dc_next'))
    fireEvent.click(screen.getByTestId('checkout-payment-method-alif_mobi'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('4. клик по активному способу (cash_courier) вызывает onSelect', () => {
    const onSelect = vi.fn()
    render(<PaymentMethodSection selected="cash_courier" onSelect={onSelect} t={t} />)
    fireEvent.click(screen.getByTestId('checkout-payment-method-cash_courier'))
    expect(onSelect).toHaveBeenCalledWith('cash_courier')
  })
})
