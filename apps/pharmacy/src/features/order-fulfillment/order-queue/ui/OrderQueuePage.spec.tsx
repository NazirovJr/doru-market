import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { PharmacyTerminalQueueItemDto } from '@dorutj/contracts'
import { useAuthStore } from '@/shared/api/auth-store'
import { OrderQueuePage } from './OrderQueuePage'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OrderQueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

function makeItem(overrides: Partial<PharmacyTerminalQueueItemDto>): PharmacyTerminalQueueItemDto {
  return {
    id: 'order-1',
    orderNumber: 'DTJ-260925-00001',
    status: 'paid_escrow',
    itemsCount: 1,
    itemsTotalTjs: 100,
    paymentMethod: 'alif_mobi',
    prescriptionRequired: false,
    slaDeadlineAt: null,
    assignedPharmacistId: null,
    assignedPharmacistName: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: 'refresh',
    user: { id: 'me', role: 'pharmacist', tenantId: 'tenant-1', phoneNumber: null, fullName: null },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('<OrderQueuePage /> (DTJ-310)', () => {
  it('рендерит обе секции — «Новые» и «В сборке», карточки распределены по статусу', async () => {
    const items = [
      makeItem({ id: 'a', status: 'paid_escrow' }),
      makeItem({ id: 'b', status: 'processing', assignedPharmacistId: 'me' }),
    ]
    stubFetch(() => Promise.resolve(jsonResponse({ data: items })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('order-queue-card')).toHaveLength(2) })
    expect(screen.getByTestId('order-card-accept-cta')).toBeInTheDocument()
    expect(screen.getByTestId('order-card-own-badge')).toBeInTheDocument()
  })

  it('пустая очередь — обе секции показывают пустое состояние', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-queue-page')).toBeInTheDocument() })
    expect(screen.queryAllByTestId('order-queue-card')).toHaveLength(0)
  })

  it('«Принять» — оптимистичный переход карточки в «В сборке» до ответа сервера (критерий приёмки 3)', async () => {
    let resolveAccept: (() => void) | undefined
    stubFetch((url) => {
      if (typeof url === 'string' && url.includes('/accept')) {
        return new Promise((resolve) => {
          resolveAccept = () => { resolve(jsonResponse({ data: { id: 'order-1', status: 'processing', slaDeadlineAt: null, assignedPharmacistId: 'me' } })) }
        })
      }
      return Promise.resolve(jsonResponse({ data: [makeItem({ id: 'order-1', status: 'paid_escrow' })] }))
    })
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-card-accept-cta')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('order-card-accept-cta'))

    await waitFor(() => { expect(screen.queryByTestId('order-card-accept-cta')).not.toBeInTheDocument() })
    expect(screen.getByTestId('order-card-own-badge')).toBeInTheDocument()
    resolveAccept?.()
  })

  it('«Принять» с гонкой (409 ORDER_ALREADY_CLAIMED) — откат на карточку «В работе: коллега», кнопка «Принять» скрыта (негативный сценарий)', async () => {
    let alreadyClaimed = false
    stubFetch((url) => {
      if (typeof url === 'string' && url.includes('/accept')) {
        alreadyClaimed = true
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'ORDER_ALREADY_CLAIMED', details: { assignedPharmacistId: 'colleague-1', assignedPharmacistName: 'Фарзона М.' } } },
            409,
          ),
        )
      }
      // После конфликта сервер (реалистично) уже отдаёт карточку занятой коллегой — мок отражает это состояние для onSettled-рефетча.
      return Promise.resolve(
        jsonResponse({
          data: [
            makeItem(
              alreadyClaimed
                ? { id: 'order-1', status: 'processing', assignedPharmacistId: 'colleague-1', assignedPharmacistName: 'Фарзона М.' }
                : { id: 'order-1', status: 'paid_escrow' },
            ),
          ],
        }),
      )
    })
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-card-accept-cta')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('order-card-accept-cta'))

    await waitFor(() => { expect(screen.queryByTestId('order-card-accept-cta')).not.toBeInTheDocument() })
    expect(screen.getByTestId('order-card-assigned-badge')).toHaveTextContent('Фарзона М.')
  })
})
