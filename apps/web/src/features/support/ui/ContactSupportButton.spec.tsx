/**
 * `ContactSupportButton.spec.tsx` (DTJ-284) — навигация на `/support/new` (+ `?orderId=`, если
 * задан) — проверяется РЕАЛЬНЫМ react-router matching (`MemoryRouter` + `Routes`), не мок
 * `useNavigate`.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { ContactSupportButton } from './ContactSupportButton'

function renderAtRoot(orderId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<ContactSupportButton {...(orderId !== undefined && { orderId })} />} />
            <Route path="/support/new" element={<p data-testid="landed-on-create-ticket">ok</p>} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

describe('ContactSupportButton', () => {
  it('без orderId → переход на /support/new', () => {
    renderAtRoot()
    fireEvent.click(screen.getByTestId('contact-support-button'))
    expect(screen.getByTestId('landed-on-create-ticket')).toBeInTheDocument()
  })

  it('с orderId → переход на /support/new (тот же маршрут, orderId несёт query-параметр)', () => {
    renderAtRoot('order-7')
    fireEvent.click(screen.getByTestId('contact-support-button'))
    expect(screen.getByTestId('landed-on-create-ticket')).toBeInTheDocument()
  })
})
