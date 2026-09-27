import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PharmacyAccountAdminSummaryDto, PharmacyScheduleAndZoneDto } from '@dorutj/contracts'
import { PharmacySchedulePage } from './pharmacy-schedule-page'

const OWN_PHARMACY: PharmacyAccountAdminSummaryDto = {
  id: 'pharmacy-1',
  chainId: 'chain-1',
  chainName: 'Salom Network',
  name: 'Аптека на Рудаки',
  status: 'active',
  licenseExpiryDate: null,
}

const SCHEDULE: PharmacyScheduleAndZoneDto = { id: 'pharmacy-1', isOpen247: false, openingTime: '09:00', closingTime: '18:00', maxDeliveryRadiusKm: 10 }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function patchCalls(fetchMock: ReturnType<typeof vi.fn<FetchImpl>>, path: string): unknown[] {
  return fetchMock.mock.calls.filter(([url, init]) => init?.method === 'PATCH' && url.includes(path))
}

async function renderPage(patchImpl: (path: string) => Promise<Response>): Promise<ReturnType<typeof vi.fn<FetchImpl>>> {
  const fetchMock = stubFetch((url, init) => {
    if (init?.method === 'PATCH') return patchImpl(url)
    if (url.includes('/schedule')) return Promise.resolve(jsonResponse({ data: SCHEDULE }))
    return Promise.resolve(jsonResponse({ data: [OWN_PHARMACY] }))
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PharmacySchedulePage />
    </QueryClientProvider>,
  )
  await waitFor(() => { expect(screen.getByTestId('pharmacy-schedule-hours-section')).toBeInTheDocument() })
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PharmacySchedulePage (DTJ-367)', () => {
  it('предзаполняет форму текущими значениями расписания и зоны доставки', async () => {
    await renderPage(() => Promise.resolve(jsonResponse({ data: SCHEDULE })))

    expect(screen.getByLabelText('Открытие')).toHaveValue('09:00')
    expect(screen.getByLabelText('Закрытие')).toHaveValue('18:00')
    expect(screen.getByLabelText('Радиус доставки, км')).toHaveValue(10)
  })

  it('Круглосуточно скрывает поля времени и отправляет PATCH с null временем', async () => {
    const fetchMock = await renderPage(() => Promise.resolve(jsonResponse({ data: { ...SCHEDULE, isOpen247: true } })))

    fireEvent.click(screen.getByLabelText('Круглосуточно'))
    expect(screen.queryByLabelText('Открытие')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить расписание' }))

    await waitFor(() => { expect(patchCalls(fetchMock, '/schedule')).toHaveLength(1) })
    const [, init] = patchCalls(fetchMock, '/schedule')[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ isOpen247: true, openingTime: null, closingTime: null })
    expect(await screen.findByText('Расписание сохранено')).toBeInTheDocument()
  })

  it('отрицательный радиус блокирует отправку PATCH delivery-zone', async () => {
    const fetchMock = await renderPage(() => Promise.resolve(jsonResponse({ data: SCHEDULE })))

    fireEvent.change(screen.getByLabelText('Радиус доставки, км'), { target: { value: '-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить зону доставки' }))

    expect(patchCalls(fetchMock, '/delivery-zone')).toHaveLength(0)
  })

  it('валидный радиус отправляет PATCH delivery-zone, успех показывает статус', async () => {
    const fetchMock = await renderPage(() => Promise.resolve(jsonResponse({ data: { id: 'pharmacy-1', maxDeliveryRadiusKm: 5 } })))

    fireEvent.change(screen.getByLabelText('Радиус доставки, км'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить зону доставки' }))

    await waitFor(() => { expect(patchCalls(fetchMock, '/delivery-zone')).toHaveLength(1) })
    expect(await screen.findByText('Зона доставки сохранена')).toBeInTheDocument()
  })
})
