import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SyncHistoryPage from './SyncHistoryPage'

/**
 * `SyncHistoryPage.spec.tsx` (DTJ-169) — сквозной тест композиции, критерий приёмки 1: 25 батчей
 * за месяц, первые 20 — с кнопкой «Показать ещё», клик подгружает оставшиеся 5 без дублей.
 */
function batchesPage(ids: readonly string[], hasMore: boolean, nextCursor: string | null): Response {
  const data = ids.map((id) => ({
    batchId: id,
    channel: 'rest',
    syncType: 'delta',
    status: 'completed_full_success',
    totalRows: 5,
    acceptedRows: 5,
    rejectedRows: 0,
    receivedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    sourceUploadId: null,
  }))
  return new Response(JSON.stringify({ data, meta: { pagination: { hasMore, nextCursor, limit: 20 } } }), { status: 200 })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SyncHistoryPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<SyncHistoryPage /> (DTJ-169, критерий приёмки 1)', () => {
  it('25 батчей за месяц: первые 20 + «Показать ещё», клик подгружает оставшиеся 5 без дублей', async () => {
    const first20 = Array.from({ length: 20 }, (_, index) => `b${String(index + 1)}`)
    const last5 = Array.from({ length: 5 }, (_, index) => `b${String(index + 21)}`)
    const fetchMock = vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost:3000')
      return Promise.resolve(
        url.searchParams.get('cursor') === null
          ? batchesPage(first20, true, 'cursor-21')
          : batchesPage(last5, false, null),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId(/^sync-batch-row-/)).toHaveLength(20) })
    expect(screen.getByTestId('sync-history-load-more')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('sync-history-load-more'))

    await waitFor(() => { expect(screen.getAllByTestId(/^sync-batch-row-/)).toHaveLength(25) })
    expect(screen.queryByTestId('sync-history-load-more')).not.toBeInTheDocument()

    const rowTestIds = screen.getAllByTestId(/^sync-batch-row-/).map((row) => row.dataset.testid)
    expect(new Set(rowTestIds).size).toBe(25)
  })
})
