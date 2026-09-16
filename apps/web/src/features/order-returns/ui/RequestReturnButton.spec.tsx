/**
 * `RequestReturnButton.spec.tsx` (DTJ-276) — АС1 (видна и ведёт на форму, окно не истекло), АС3
 * (окно истекло → кнопка не отображается вовсе — не `disabled`).
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { RequestReturnButton, type RequestReturnButtonProps } from './RequestReturnButton'

const DELIVERED_AT = '2026-01-01T00:00:00.000Z'
const ONE_HOUR_MS = 3_600_000

function renderAtRoot(props: RequestReturnButtonProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<RequestReturnButton {...props} />} />
            <Route path="/order-returns/new" element={<p data-testid="landed-on-request-return-form">ok</p>} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

describe('RequestReturnButton (DTJ-276)', () => {
  it('АС1: delivered + окно не истекло → кнопка видна и ведёт на /order-returns/new', () => {
    renderAtRoot({
      orderId: 'order-7',
      orderStatus: 'delivered',
      deliveredAt: DELIVERED_AT,
      disputeWindowHours: 48,
      now: () => new Date(DELIVERED_AT).getTime() + ONE_HOUR_MS,
    })

    fireEvent.click(screen.getByTestId('request-return-button'))
    expect(screen.getByTestId('landed-on-request-return-form')).toBeInTheDocument()
  })

  it('АС3: окно истекло → кнопка не отображается вовсе (не disabled)', () => {
    renderAtRoot({
      orderId: 'order-7',
      orderStatus: 'delivered',
      deliveredAt: DELIVERED_AT,
      disputeWindowHours: 48,
      now: () => new Date(DELIVERED_AT).getTime() + 49 * ONE_HOUR_MS,
    })

    expect(screen.queryByTestId('request-return-button')).not.toBeInTheDocument()
  })

  it('заказ НЕ delivered → кнопка не отображается, даже если бы окно формально не истекло', () => {
    renderAtRoot({
      orderId: 'order-7',
      orderStatus: 'processing',
      deliveredAt: null,
      disputeWindowHours: 48,
      now: () => Date.now(),
    })

    expect(screen.queryByTestId('request-return-button')).not.toBeInTheDocument()
  })

  it('disputeWindowHours отсутствует (сервер ещё не отдал) → кнопка скрыта, а не показана «по умолчанию»', () => {
    renderAtRoot({
      orderId: 'order-7',
      orderStatus: 'delivered',
      deliveredAt: DELIVERED_AT,
      disputeWindowHours: null,
      now: () => new Date(DELIVERED_AT).getTime(),
    })

    expect(screen.queryByTestId('request-return-button')).not.toBeInTheDocument()
  })
})
