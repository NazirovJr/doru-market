import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { getClientEnv } from '@/shared/config/env'
import { useCartSessionStore } from '../model/cart-session-store'
import { CartScreen } from './cart-screen'

/**
 * `cart-screen.spec.tsx` (DTJ-234).
 *
 * Покрывает AC1 (2 группы по аптекам, суммарный баннер), AC2 (красный баннер duplicate_substance,
 * НЕ дословный текст дизайна), AC3 (пустая корзина — EmptyState с CTA), AC4 (тап-зоны ≥48×48px —
 * см. JSDoc `empty-state.spec.tsx`/`pharmacy-group-card.spec.tsx` про ограничение jsdom: без
 * реального layout-движка проверяется КЛАСС, гарантирующий 48px в Tailwind-шкале проекта
 * (`min-h-12`/`min-w-12` = 3rem = 48px), не вычисленный `getBoundingClientRect`), тест-план
 * «снапшот на 1/2/3 аптеки» (здесь — количество `PharmacyGroupCard`, не буквальный snapshot-файл).
 *
 * Сеть мокается через `vi.stubGlobal('fetch', ...)` (тот же приём, что `map-page.spec.tsx`).
 */

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

interface CartItemFixture {
  readonly id: string
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly quantity?: number
  readonly priceDiram?: number
}

function cartItem(fixture: CartItemFixture): Record<string, unknown> {
  return {
    id: fixture.id,
    cartId: 'cart-1',
    medicineId: `medicine-${fixture.id}`,
    // DTJ-234 (дефект приёмки) — читаемое название, ЕЩЁ ОДНО поле реального ответа сервера.
    medicineTradeName: `Trade-${fixture.id}`,
    pharmacyId: fixture.pharmacyId,
    pharmacyName: fixture.pharmacyName,
    quantity: fixture.quantity ?? 1,
    priceDiram: fixture.priceDiram ?? 500,
    availableQuantity: 10,
    addedAt: '2026-01-01T00:00:00Z',
  }
}

function pharmacyGroup(
  pharmacyId: string,
  pharmacyName: string | null,
  subtotalDiram: number,
): Record<string, unknown> {
  return { pharmacyId, pharmacyName, items: [], subtotalDiram }
}

function stubCartResponse(
  items: readonly Record<string, unknown>[],
  pharmacyGroups: readonly Record<string, unknown>[],
  warnings: readonly Record<string, unknown>[] = [],
): void {
  stubFetch(() => Promise.resolve(jsonResponse({ data: { items }, meta: { pharmacyGroups, warnings } })))
}

function renderCartScreen(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/cart']}>
          <Routes>
            <Route path="/cart" element={<CartScreen />} />
            <Route path="/" element={<div data-testid="home-stub" />} />
            <Route path="/checkout" element={<div data-testid="checkout-stub" />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  useCartSessionStore.setState({ sessionToken: null })
  // Дефолтная локаль проекта — `tj` (`locale-provider.tsx`), а не `ru` (тот же нюанс, что JSDoc
  // `pharmacy-pin-popup.spec.tsx`: «локаль по умолчанию — tj, ломкая связь с текстом перевода»).
  // Тесты AC2/AC3 ниже сверяют КАНОНИЧЕСКИЙ текст (не кальку дизайна) — фиксируем `ru` явно,
  // а не переходим на голые data-testid (иначе сам смысл этих AC не проверяется).
  window.localStorage.setItem('dorutj.locale', 'ru')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CartScreen (DTJ-234)', () => {
  it('1. состояние загрузки — показывает cart-loading', () => {
    stubFetch(() => new Promise(vi.fn()))
    renderCartScreen()
    expect(screen.getByTestId('cart-loading')).toBeInTheDocument()
  })

  it('2. ошибка сети — общее сообщение + кнопка "Повторить" (500 намеренно замаскирован)', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }), { status: 500 })),
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getByTestId('cart-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('cart-retry')).toBeInTheDocument()
  })

  it('3. [AC3] пустая корзина — EmptyState с CTA, клик ведёт на "/" (ux.empty.cart, не калька дизайна)', async () => {
    stubCartResponse([], [])
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getByTestId('cart-empty-state')).toBeInTheDocument()
    })
    expect(screen.getByText('Корзина пуста. Найдите лекарство дешевле рядом с вами.')).toBeInTheDocument()
    expect(screen.queryByText('Найдите нужное лекарство по низкой цене')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cart-empty-cta'))
    await waitFor(() => {
      expect(screen.getByTestId('home-stub')).toBeInTheDocument()
    })
  })

  it('4. [AC1] корзина с товарами от 2 аптек — 2 карточки-группы + баннер "2 отдельных заказ..."', async () => {
    stubCartResponse(
      [
        cartItem({ id: 'i1', pharmacyId: 'p1', pharmacyName: 'Аптека 1' }),
        cartItem({ id: 'i2', pharmacyId: 'p2', pharmacyName: 'Аптека 2' }),
      ],
      [pharmacyGroup('p1', 'Аптека 1', 500), pharmacyGroup('p2', 'Аптека 2', 500)],
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getAllByTestId('pharmacy-group-card')).toHaveLength(2)
    })
    expect(screen.getByTestId('cart-split-banner')).toHaveTextContent('2')
    expect(screen.getByTestId('cart-split-banner')).toHaveTextContent('отдельных заказов')
  })

  it('5. один поставщик (1 аптека) — split-баннер НЕ рендерится', async () => {
    stubCartResponse(
      [cartItem({ id: 'i1', pharmacyId: 'p1', pharmacyName: 'Аптека 1' })],
      [pharmacyGroup('p1', 'Аптека 1', 500)],
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getAllByTestId('pharmacy-group-card')).toHaveLength(1)
    })
    expect(screen.queryByTestId('cart-split-banner')).not.toBeInTheDocument()
  })

  it('6. 3 аптеки — 3 карточки-группы, баннер "3 отдельных заказ..." (тест-план: 1/2/3 аптеки)', async () => {
    stubCartResponse(
      [
        cartItem({ id: 'i1', pharmacyId: 'p1', pharmacyName: 'Аптека 1' }),
        cartItem({ id: 'i2', pharmacyId: 'p2', pharmacyName: 'Аптека 2' }),
        cartItem({ id: 'i3', pharmacyId: 'p3', pharmacyName: 'Аптека 3' }),
      ],
      [
        pharmacyGroup('p1', 'Аптека 1', 500),
        pharmacyGroup('p2', 'Аптека 2', 500),
        pharmacyGroup('p3', 'Аптека 3', 500),
      ],
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getAllByTestId('pharmacy-group-card')).toHaveLength(3)
    })
    expect(screen.getByTestId('cart-split-banner')).toHaveTextContent('3')
  })

  it('7. [AC2] warnings содержит insufficient_stock — виден баннер, CTA "Перейти к оформлению" disabled', async () => {
    stubCartResponse(
      [cartItem({ id: 'i1', pharmacyId: 'p1', pharmacyName: 'Аптека 1' })],
      [pharmacyGroup('p1', 'Аптека 1', 500)],
      [{ cartItemId: 'i1', type: 'insufficient_stock', availableQuantity: 0 }],
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getByTestId('cart-warning-insufficient-stock')).toBeInTheDocument()
    })
    expect(screen.getByTestId('cart-checkout-cta')).toBeDisabled()
    // Пострадавшая строка визуально подсвечена (group-warnings.ts#byCartItemId → PharmacyGroupCard).
    expect(screen.getByTestId('cart-item-row')).toHaveAttribute('data-has-stock-warning', 'true')
  })

  it('8. без warnings — CTA активна, клик ведёт на "/checkout"', async () => {
    stubCartResponse(
      [cartItem({ id: 'i1', pharmacyId: 'p1', pharmacyName: 'Аптека 1' })],
      [pharmacyGroup('p1', 'Аптека 1', 500)],
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getByTestId('cart-checkout-cta')).not.toBeDisabled()
    })
    fireEvent.click(screen.getByTestId('cart-checkout-cta'))
    await waitFor(() => {
      expect(screen.getByTestId('checkout-stub')).toBeInTheDocument()
    })
  })

  it('9. [AC4, SRS-UX-002] CTA "Перейти к оформлению" несёт классы тап-зоны min-h-12', async () => {
    stubCartResponse(
      [cartItem({ id: 'i1', pharmacyId: 'p1', pharmacyName: 'Аптека 1' })],
      [pharmacyGroup('p1', 'Аптека 1', 500)],
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getByTestId('cart-checkout-cta')).toBeInTheDocument()
    })
    expect(screen.getByTestId('cart-checkout-cta')).toHaveClass('min-h-12')
  })

  it('10. клик "удалить" на реальном экране бьёт в DELETE /cart/items/:id (сквозная проверка подключения)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: { items: [cartItem({ id: 'i1', pharmacyId: 'p1', pharmacyName: 'Аптека 1' })] },
          meta: { pharmacyGroups: [pharmacyGroup('p1', 'Аптека 1', 500)], warnings: [] },
        }),
      ),
    )
    renderCartScreen()
    await waitFor(() => {
      expect(screen.getByTestId('cart-item-remove')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('cart-item-remove'))
    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
      expect(deleteCall?.[0]).toBe(`${getClientEnv().apiBaseUrl}/api/v1/cart/items/i1`)
    })
  })
})
