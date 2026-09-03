import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { getClientEnv } from '@/shared/config/env'
import { useAuthStore } from '@/shared/api/auth-store'
import { LocaleProvider, useLocale } from '@/shared/config/locale-provider'
import { CheckoutScreen } from './checkout-screen'

/**
 * `checkout-screen.spec.tsx` (DTJ-235) — обязательные критерии приёмки:
 *   AC1 (SRS-UX-050/TC-UX-004) — двойной клик → РОВНО ОДИН `POST /api/v1/orders`.
 *   AC2 — частичный успех (`orders`+`failedGroups` непустые ОДНОВРЕМЕННО) отрендерен честно.
 *   AC3 (SRS-UX-054) — переключение локали посреди формы не сбрасывает введённые данные.
 *   AC4 — банковские способы оплаты задизейблены, клик по ним ничего не отправляет.
 */

const CART_URL = `${getClientEnv().apiBaseUrl}/api/v1/cart`
const ORDERS_URL = `${getClientEnv().apiBaseUrl}/api/v1/orders`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const CART_RESPONSE = {
  data: {
    items: [
      { id: 'item-1', cartId: 'cart-1', medicineId: 'm1', medicineTradeName: 'Парацетамол', pharmacyId: 'p1', pharmacyName: 'Аптека Салом', quantity: 2, priceDiram: 500, availableQuantity: 5, addedAt: 'x' },
    ],
  },
  meta: { pharmacyGroups: [{ pharmacyId: 'p1', pharmacyName: 'Аптека Салом', items: [], subtotalDiram: 1000 }] },
}

function stubFetchRouter(orderResponder: () => Response): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>((url, init) => {
    if (url === CART_URL) {
      return Promise.resolve(jsonResponse(CART_RESPONSE))
    }
    if (url === ORDERS_URL && init?.method === 'POST') {
      return Promise.resolve(orderResponder())
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderCheckout(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/checkout']}>
          <CheckoutScreen />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

/** Гарнитура для AC3 — программный переключатель локали рядом с экраном (тот же контекст, что
 *  `AppLayout`'s `LanguageSwitcherPlaceholder`, но не тянет весь layout ради одного теста). */
const CheckoutWithLocaleSwitcher = (): ReactElement => {
  const { setLocale } = useLocale()
  return (
    <div>
      <button type="button" data-testid="test-switch-locale-en" onClick={() => { setLocale('en') }}>
        en
      </button>
      <CheckoutScreen />
    </div>
  )
}

function renderCheckoutWithLocaleSwitcher(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/checkout']}>
          <CheckoutWithLocaleSwitcher />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

async function fillValidAddress(): Promise<void> {
  fireEvent.change(screen.getByTestId('checkout-address-text-input'), { target: { value: 'ул. Рудаки, 12' } })
  fireEvent.click(screen.getByTestId('checkout-address-map-picker-button'))
  await waitFor(() => {
    expect(screen.getByTestId('checkout-submit-cta')).not.toBeDisabled()
  })
}

beforeEach(() => {
  window.localStorage.clear()
  useAuthStore.setState({
    accessToken: 'test-access-token',
    refreshToken: null,
    user: { id: 'u1', role: 'customer', tenantId: 't1', phoneNumber: '+992900000000', fullName: 'Test' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('CheckoutScreen (DTJ-235)', () => {
  it('гость (нет accessToken) — видит приглашение войти, форма НЕ рендерится, GET /cart не уходит', async () => {
    useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
    const fetchMock = stubFetchRouter(() => jsonResponse({ data: { orders: [], failedGroups: [] } }))
    renderCheckout()
    expect(await screen.findByTestId('checkout-unauthenticated')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('пустая корзина — показывает checkout-empty-cart, не форму', async () => {
    const fetchMock = vi.fn<FetchImpl>((url) => {
      if (url === CART_URL) {
        return Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [] } }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderCheckout()
    expect(await screen.findByTestId('checkout-empty-cart')).toBeInTheDocument()
  })

  it('AC1/TC-UX-004: двойной быстрый клик по «Оформить заказ» → РОВНО ОДИН POST /api/v1/orders, кнопка уходит в loading', async () => {
    const fetchMock = stubFetchRouter(() => jsonResponse({ data: { orders: [{ orderId: 'o1', orderNumber: 'A-1', pharmacyId: 'p1', status: 'confirmed', totalAmountDiram: 1000, paymentPending: false }], failedGroups: [] } }))
    renderCheckout()
    await screen.findByTestId('checkout-screen')
    await fillValidAddress()

    const submitButton = screen.getByTestId('checkout-submit-cta')
    act(() => {
      fireEvent.click(submitButton)
      fireEvent.click(submitButton)
    })

    expect(screen.getByTestId('checkout-submit-cta')).toBeDisabled()
    await waitFor(() => { expect(screen.getByTestId('checkout-result-section')).toBeInTheDocument() })

    const orderPostCalls = fetchMock.mock.calls.filter(([url, init]) => url === ORDERS_URL && init?.method === 'POST')
    expect(orderPostCalls).toHaveLength(1)
  })

  it('SRS-ORD-023 (поправка CTO волна 6): POST /orders отправляет expectedTotalDiramByPharmacy, построенный из meta.pharmacyGroups[].subtotalDiram корзины', async () => {
    const fetchMock = stubFetchRouter(() => jsonResponse({ data: { orders: [{ orderId: 'o1', orderNumber: 'A-1', pharmacyId: 'p1', status: 'confirmed', totalAmountDiram: 1000, paymentPending: false }], failedGroups: [] } }))
    renderCheckout()
    await screen.findByTestId('checkout-screen')
    await fillValidAddress()

    fireEvent.click(screen.getByTestId('checkout-submit-cta'))
    await waitFor(() => { expect(screen.getByTestId('checkout-result-section')).toBeInTheDocument() })

    const [, init] = fetchMock.mock.calls.find(([url, i]) => url === ORDERS_URL && i?.method === 'POST') ?? []
    const body: unknown = JSON.parse(init?.body as string)
    expect(body).toMatchObject({ expectedTotalDiramByPharmacy: { p1: 1000 } })
  })

  it('AC2: частичный успех — orders И failedGroups непустые ОДНОВРЕМЕННО, оба видны на экране результата', async () => {
    stubFetchRouter(() =>
      jsonResponse({
        data: {
          orders: [{ orderId: 'o1', orderNumber: 'A-1', pharmacyId: 'p1', status: 'confirmed', totalAmountDiram: 1000, paymentPending: false }],
          failedGroups: [{ pharmacyId: 'p2', reason: 'INSUFFICIENT_STOCK' }],
        },
      }),
    )
    renderCheckout()
    await screen.findByTestId('checkout-screen')
    await fillValidAddress()
    fireEvent.click(screen.getByTestId('checkout-submit-cta'))

    await waitFor(() => { expect(screen.getByTestId('checkout-result-section')).toBeInTheDocument() })
    expect(screen.getAllByTestId('checkout-result-order')).toHaveLength(1)
    expect(screen.getAllByTestId('checkout-result-failed-group')).toHaveLength(1)
  })

  it('AC3/SRS-UX-054: переключение локали посреди формы не сбрасывает введённый адрес/ориентир', async () => {
    stubFetchRouter(() => jsonResponse({ data: { orders: [], failedGroups: [] } }))
    renderCheckoutWithLocaleSwitcher()
    await screen.findByTestId('checkout-screen')

    fireEvent.change(screen.getByTestId('checkout-address-text-input'), { target: { value: 'ул. Рудаки, 12' } })
    fireEvent.change(screen.getByTestId('checkout-address-landmark-input'), { target: { value: 'у мечети' } })
    fireEvent.change(screen.getByTestId('checkout-address-floor-input'), { target: { value: '5' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('test-switch-locale-en'))
      await Promise.resolve()
    })

    await waitFor(() => { expect(screen.getByText('Checkout')).toBeInTheDocument() })
    expect(screen.getByTestId('checkout-address-text-input')).toHaveValue('ул. Рудаки, 12')
    expect(screen.getByTestId('checkout-address-landmark-input')).toHaveValue('у мечети')
    expect(screen.getByTestId('checkout-address-floor-input')).toHaveValue('5')
  })

  it('AC4: банковские способы оплаты задизейблены на экране, клик по ним не запускает никакой запрос', async () => {
    const fetchMock = stubFetchRouter(() => jsonResponse({ data: { orders: [], failedGroups: [] } }))
    renderCheckout()
    await screen.findByTestId('checkout-screen')

    await act(async () => {
      fireEvent.click(screen.getByTestId('checkout-payment-method-dc_next'))
      fireEvent.click(screen.getByTestId('checkout-payment-method-alif_mobi'))
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.filter(([url]) => url === ORDERS_URL)).toHaveLength(0)
    expect(screen.getByTestId('checkout-payment-method-cash_courier')).toHaveAttribute('aria-checked', 'true')
  })
})
