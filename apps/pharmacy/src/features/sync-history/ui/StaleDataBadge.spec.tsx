import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventorySyncBatchListItemDto } from '@dorutj/contracts'
import { StaleDataBadge } from './StaleDataBadge'

function freshBatch(overrides?: Partial<InventorySyncBatchListItemDto>): InventorySyncBatchListItemDto {
  return {
    batchId: 'b1',
    channel: 'rest',
    syncType: 'delta',
    status: 'completed_full_success',
    totalRows: 10,
    acceptedRows: 10,
    rejectedRows: 0,
    receivedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    sourceUploadId: null,
    ...overrides,
  }
}

type FetchImpl = () => Promise<Response>

function stubTenantMeta(inventoryDeltaSlaMinutes: number, inventoryManualStaleHours = 72): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(() =>
    Promise.resolve(new Response(JSON.stringify({ data: { inventoryDeltaSlaMinutes, inventoryManualStaleHours } }), { status: 200 })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderWithQueryClient(ui: ReactNode): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<StaleDataBadge /> (DTJ-169/DTJ-033 — пороги из GET /tenant/meta)', () => {
  it('критерий 2 DTJ-033: REST-батч 10 минут назад, порог тенанта 15 минут — не устарело', async () => {
    stubTenantMeta(15)
    const now = new Date('2026-01-01T00:10:00.000Z')

    renderWithQueryClient(<StaleDataBadge freshestBatch={freshBatch()} now={now} />)

    await waitFor(() => { expect(screen.getByTestId('stale-data-badge')).toBeInTheDocument() })
    expect(screen.getByTestId('stale-data-badge').dataset.stale).toBe('false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('критерий 2 DTJ-033: тот же REST-батч 10 минут назад, порог тенанта 5 минут — устарело', async () => {
    stubTenantMeta(5)
    const now = new Date('2026-01-01T00:10:00.000Z')

    renderWithQueryClient(<StaleDataBadge freshestBatch={freshBatch()} now={now} />)

    await waitFor(() => { expect(screen.getByTestId('stale-data-badge').dataset.stale).toBe('true') })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByTestId('stale-data-badge')).toHaveTextContent('0')
  })

  it('канал manual — порог в часах из тенанта (inventoryManualStaleHours), не REST-минуты', async () => {
    stubTenantMeta(15, 1)
    const now = new Date('2026-01-01T02:00:00.000Z') // 2 часа спустя, порог manual — 1 час

    renderWithQueryClient(<StaleDataBadge freshestBatch={freshBatch({ channel: 'manual' })} now={now} />)

    await waitFor(() => { expect(screen.getByTestId('stale-data-badge').dataset.stale).toBe('true') })
  })

  it('без единого батча — нейтральное сообщение, пороги не запрашиваются (enabled=false)', () => {
    const fetchMock = stubTenantMeta(5)

    renderWithQueryClient(<StaleDataBadge freshestBatch={null} />)

    expect(screen.getByTestId('stale-data-badge-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stale-data-badge')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
