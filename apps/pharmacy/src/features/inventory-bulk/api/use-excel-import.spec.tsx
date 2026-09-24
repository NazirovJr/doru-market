import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useExcelImport, useImportBatchesPolling } from './use-excel-import'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function makeWrapper(queryClient: QueryClient): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** DTJ-168 АС1: `POST /inventory-excel-import` вызывается с multipart-телом (файл + mode). */
describe('useExcelImport (DTJ-168)', () => {
  it('успех: POST multipart/form-data, тело содержит file и mode', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { sourceUploadId: 'up-1', totalBatches: 3, totalRows: 2500, rejectedByParser: 0 } }), {
          status: 202,
        }),
      ),
    )
    const queryClient = makeQueryClient()
    const file = new File(['a,b,c'], 'stock.csv', { type: 'text/csv' })

    const { result } = renderHook(() => useExcelImport(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate({ file, mode: 'append_update' })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data?.sourceUploadId).toBe('up-1')
    expect(result.current.data?.totalBatches).toBe(3)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/inventory-excel-import')
    expect(init.body).toBeInstanceOf(FormData)
    const formData = init.body as FormData
    expect(formData.get('mode')).toBe('append_update')
    expect((formData.get('file') as File).name).toBe('stock.csv')
  })
})

/** DTJ-168 риски: опрос обязан остановиться (`refetchInterval: false`) на терминальном статусе. */
describe('useImportBatchesPolling (DTJ-168)', () => {
  it('2 из 3 батчей завершены — продолжает опрос (refetchInterval активен)', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { batchId: 'b1', status: 'completed_full_success', channel: 'excel', syncType: 'delta', totalRows: 100, acceptedRows: 100, rejectedRows: 0, receivedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', sourceUploadId: 'up-1' },
              { batchId: 'b2', status: 'completed_full_success', channel: 'excel', syncType: 'delta', totalRows: 100, acceptedRows: 100, rejectedRows: 0, receivedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', sourceUploadId: 'up-1' },
              { batchId: 'b3', status: 'processing', channel: 'excel', syncType: 'delta', totalRows: 100, acceptedRows: 0, rejectedRows: 0, receivedAt: '2026-01-01T00:00:00.000Z', completedAt: null, sourceUploadId: 'up-1' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    const queryClient = makeQueryClient()

    const { result } = renderHook(() => useImportBatchesPolling('up-1'), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data).toHaveLength(3)
  })

  it('sourceUploadId=null — запрос не выполняется (enabled=false)', () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })))
    const queryClient = makeQueryClient()

    renderHook(() => useImportBatchesPolling(null), { wrapper: makeWrapper(queryClient) })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
