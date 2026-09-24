import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportProgressBar } from './ImportProgressBar'
import { IMPORT_POLL_INTERVAL_MS } from '@/features/inventory-bulk/api/use-excel-import'

function batchesResponse(status: string): Response {
  return new Response(
    JSON.stringify({
      data: [
        { batchId: 'b1', status, channel: 'excel', syncType: 'delta', totalRows: 100, acceptedRows: status.startsWith('completed') ? 100 : 0, rejectedRows: 0, receivedAt: '2026-01-01T00:00:00.000Z', completedAt: null, sourceUploadId: 'up-1' },
      ],
    }),
    { status: 200 },
  )
}

function renderBar(queryClient: QueryClient): void {
  render(
    <QueryClientProvider client={queryClient}>
      <ImportProgressBar sourceUploadId="up-1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** DTJ-168 риски: `refetchInterval` обязан выключиться после `isComplete=true` — иначе бесконечная утечка опроса. */
describe('<ImportProgressBar /> (DTJ-168)', () => {
  it('останавливает опрос после того, как батч достигает терминального статуса', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(batchesResponse('completed_full_success')))
    vi.stubGlobal('fetch', fetchMock)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderBar(queryClient)

    await waitFor(() => { expect(screen.getByTestId('import-progress-complete')).toBeInTheDocument() })
    const callsAfterFirstLoad = fetchMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(IMPORT_POLL_INTERVAL_MS * 5)

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstLoad)
  })

  it('батч ещё обрабатывается — прогресс-бар продолжает опрос', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(batchesResponse('processing')))
    vi.stubGlobal('fetch', fetchMock)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderBar(queryClient)

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    await vi.advanceTimersByTimeAsync(IMPORT_POLL_INTERVAL_MS + 1)

    await waitFor(() => { expect(fetchMock.mock.calls.length).toBeGreaterThan(1) })
  })
})
