import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { ErrorCode } from '@dorutj/contracts'
import type { CreateOrderResponse } from '../api/create-order.api'
import { CheckoutResultSection } from './checkout-result-section'

const { t } = useT('ru')

const PHARMACY_NAMES = new Map<string, string | null>([
  ['p1', 'Аптека Салом'],
  ['p2', 'Аптека Файз'],
])

/** AC2: «Given ответ содержит failedGroups для одной из аптек... пользователь видит И
 *  оформленные заказы, И понятное объяснение по провалившейся группе (не «всё пропало»)». */
describe('CheckoutResultSection (DTJ-235, AC2)', () => {
  it('1. частичный успех — оформленные заказы И провалившиеся группы видны ОДНОВРЕМЕННО', () => {
    const result: CreateOrderResponse = {
      orders: [{ orderId: 'order-1', orderNumber: 'A-1001', pharmacyId: 'p1', status: 'confirmed', totalAmountDiram: 5000, paymentPending: false }],
      failedGroups: [{ pharmacyId: 'p2', reason: ErrorCode.INSUFFICIENT_STOCK }],
      excludedItems: [],
    }
    render(<CheckoutResultSection result={result} pharmacyNameById={PHARMACY_NAMES} locale="ru" onContinue={vi.fn()} t={t} />)

    expect(screen.getAllByTestId('checkout-result-order')).toHaveLength(1)
    expect(screen.getByText('Аптека Салом')).toBeInTheDocument()
    expect(screen.getAllByTestId('checkout-result-failed-group')).toHaveLength(1)
    expect(screen.getByText('Аптека Файз')).toBeInTheDocument()
  })

  it('2. все группы провалились (orders пуст) — секция заказов не рендерится, провалы видны', () => {
    const result: CreateOrderResponse = {
      orders: [],
      failedGroups: [{ pharmacyId: 'p1', reason: ErrorCode.PRICE_OR_STOCK_CHANGED }],
      excludedItems: [],
    }
    render(<CheckoutResultSection result={result} pharmacyNameById={PHARMACY_NAMES} locale="ru" onContinue={vi.fn()} t={t} />)
    expect(screen.queryByTestId('checkout-result-order')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('checkout-result-failed-group')).toHaveLength(1)
  })

  it('3. PRICE_OR_STOCK_CHANGED/INSUFFICIENT_STOCK/CONTROLLED_SUBSTANCE_FORBIDDEN — каждый со своим осмысленным текстом', () => {
    const result: CreateOrderResponse = {
      orders: [],
      failedGroups: [
        { pharmacyId: 'p1', reason: ErrorCode.PRICE_OR_STOCK_CHANGED },
        { pharmacyId: 'p2', reason: ErrorCode.CONTROLLED_SUBSTANCE_FORBIDDEN },
      ],
      excludedItems: [],
    }
    render(<CheckoutResultSection result={result} pharmacyNameById={PHARMACY_NAMES} locale="ru" onContinue={vi.fn()} t={t} />)
    expect(screen.getByText(/цена или наличие/i)).toBeInTheDocument()
    expect(screen.getByText(/специальному учёту/i)).toBeInTheDocument()
  })

  it('4. неизвестный код причины — общий текст-фолбэк, не падает', () => {
    const result: CreateOrderResponse = {
      orders: [],
      failedGroups: [{ pharmacyId: 'p1', reason: 'SOME_UNKNOWN_CODE' }],
      excludedItems: [],
    }
    render(<CheckoutResultSection result={result} pharmacyNameById={PHARMACY_NAMES} locale="ru" onContinue={vi.fn()} t={t} />)
    expect(screen.getByText(/не удалось оформить заказ для этой аптеки/i)).toBeInTheDocument()
  })

  it('5. кнопка «Продолжить покупки» зовёт onContinue', () => {
    const onContinue = vi.fn()
    const result: CreateOrderResponse = { orders: [], failedGroups: [], excludedItems: [] }
    render(<CheckoutResultSection result={result} pharmacyNameById={PHARMACY_NAMES} locale="ru" onContinue={onContinue} t={t} />)
    fireEvent.click(screen.getByTestId('checkout-result-continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
