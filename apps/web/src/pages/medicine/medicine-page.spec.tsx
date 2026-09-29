import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ToastProvider } from '@dorutj/ui'
import { formatMoney, useT } from '@dorutj/i18n'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { getClientEnv } from '@/shared/config/env'
import { useGeoStore } from '@/shared/geo/geo-store'
import MedicinePage from './medicine-page'


const MEDICINE_ID = '11111111-1111-1111-1111-111111111111'
const PHARMACY_ID = '33333333-3333-3333-3333-333333333333'
const baseUrl = getClientEnv().apiBaseUrl
const { t } = useT('tj')

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const detail = {
  id: MEDICINE_ID,
  tradeName: 'Парацетамол 500',
  innName: 'Парацетамол',
  dosageForm: 'таблетки',
  dosageStrength: '500 мг',
  manufacturerName: 'Фармстандарт',
  manufacturerCountry: 'Россия',
  isPrescriptionRequired: false,
  description: null,
}

const pins = [
  { pharmacyId: 'far', name: 'Дорогая аптека', lat: 1, lon: 1, isOpenNow: true, is24x7: false, offer: { priceDiram: 9000, stockQuantity: 5, lastSyncedAt: '2026-09-01T00:00:00Z', isStale: false } },
  { pharmacyId: PHARMACY_ID, name: 'Дешёвая аптека', lat: 1, lon: 1, isOpenNow: true, is24x7: false, offer: { priceDiram: 7000, stockQuantity: 5, lastSyncedAt: '2026-09-01T00:00:00Z', isStale: true } },
  { pharmacyId: 'none', name: 'Без остатка', lat: 1, lon: 1, isOpenNow: true, is24x7: false, offer: null },
]

const analogs = {
  referenceMedicineId: MEDICINE_ID,
  items: [],
  savingsDiram: null,
  titleKey: 'catalog.analogs.title_neutral',
  disclaimer: 'Дисклеймер.',
}

function respond(url: string, pinsBody: unknown = pins): Response {
  if (url.includes('/pharmacies/map')) return jsonResponse({ data: pinsBody })
  if (url.includes('/analogs')) return jsonResponse({ data: analogs })
  if (url.includes('/cart/items')) return jsonResponse({ data: { id: 'ci' } }, 201)
  return jsonResponse({ data: detail })
}

function renderPage(id: string): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ToastProvider closeButtonLabel="x">
          <MemoryRouter initialEntries={[`/medicines/${id}`]}>
            <Routes>
              <Route path="/medicines/:id" element={<MedicinePage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useGeoStore.setState({ status: 'idle', coords: null })
  window.localStorage.clear()
})

describe('MedicinePage (DTJ-440)', () => {
  it('1. показывает название, МНН, производителя и запрашивает карточку, предложения и аналоги по :id', async () => {
    const fetchMock = stubFetch((url) => Promise.resolve(respond(url)))

    renderPage(MEDICINE_ID)

    expect(await screen.findByRole('heading', { name: 'Парацетамол 500' })).toBeInTheDocument()
    expect(screen.getByText(/Фармстандарт/)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('analogs-disclaimer')).toHaveTextContent('Дисклеймер.')
    })
    const urls = fetchMock.mock.calls.map(([url]) => url)
    expect(urls).toContain(`${baseUrl}/api/v1/medicines/${MEDICINE_ID}/analogs`)
    expect(urls.some((url) => url.startsWith(`${baseUrl}/api/v1/medicines/${MEDICINE_ID}?`))).toBe(true)
    expect(urls.some((url) => url.includes('/pharmacies/map') && url.includes(`medicineId=${MEDICINE_ID}`))).toBe(true)
  })

  it('2. предложения аптек отсортированы по цене, аптеки без предложения не показаны', async () => {
    stubFetch((url) => Promise.resolve(respond(url)))

    renderPage(MEDICINE_ID)

    const rows = await screen.findAllByTestId('pharmacy-offer-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Дешёвая аптека')
    expect(rows[0]).toHaveTextContent(formatMoney(7000, 'tj'))
    expect(rows[1]).toHaveTextContent('Дорогая аптека')
  })

  it('3. «В корзину» у предложения шлёт POST /cart/items с id препарата и аптеки', async () => {
    const fetchMock = stubFetch((url) => Promise.resolve(respond(url)))

    renderPage(MEDICINE_ID)
    const buttons = await screen.findAllByRole('button', { name: t('cart.add_item_cta') })
    fireEvent.click(buttons[0]!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/api/v1/cart/items'))).toBe(true)
    })
    const addCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/v1/cart/items'))
    expect(JSON.parse(addCall?.[1]?.body as string)).toEqual({ medicineId: MEDICINE_ID, pharmacyId: PHARMACY_ID, quantity: 1 })
    expect(await screen.findByText(t('cart.added_toast'))).toBeInTheDocument()
  })

  it('4. нет предложений — сообщение вместо списка', async () => {
    stubFetch((url) => Promise.resolve(respond(url, [])))

    renderPage(MEDICINE_ID)

    expect(await screen.findByTestId('medicine-offers-empty')).toBeInTheDocument()
  })

  it('5. препарат не найден (404) — сообщение, а не белый экран', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404)))

    renderPage(MEDICINE_ID)

    expect(await screen.findByTestId('medicine-page-error')).toHaveTextContent(t('catalog.medicine.not_found'))
  })
})
