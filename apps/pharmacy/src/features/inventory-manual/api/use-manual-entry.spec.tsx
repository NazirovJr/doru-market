import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ManualEntryRow } from '@dorutj/contracts'
import { INVENTORY_LIST_QUERY_KEY, useManualEntry } from './use-manual-entry'

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

const ROW: ManualEntryRow = { medicineId: 'med-1', priceTjs: 15.5, quantity: 10, expiryDate: '2026-12-31', op: 'upsert' }

afterEach(() => {
  vi.unstubAllGlobals()
})

/** DTJ-167 тест-план: «useManualEntry успешный вызов инвалидирует query cache и показывает Toast» (инвалидация — здесь; Toast — `PointEditForm.spec.tsx`). */
describe('useManualEntry (DTJ-167)', () => {
  it('успех: POST с ОДНОЙ строкой (rows: [row]), инвалидирует INVENTORY_LIST_QUERY_KEY', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { batchId: 'batch-1', status: 'completed', acceptedRows: 1, rejectedRows: 0, errors: [] } }),
          { status: 200 },
        ),
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useManualEntry(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate(ROW)

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data?.acceptedRows).toBe(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/inventory-manual-entry')
    expect(JSON.parse(init.body as string)).toEqual({ rows: [ROW] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: INVENTORY_LIST_QUERY_KEY })
  })

  it('ошибка 403 INSUFFICIENT_ROLE — isError=true, code проброшен наверх нетронутым', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'INSUFFICIENT_ROLE', message: 'forbidden' } }), { status: 403 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

    const { result } = renderHook(() => useManualEntry(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate(ROW)

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    expect(result.current.error?.code).toBe('INSUFFICIENT_ROLE')
    expect(result.current.data).toBeUndefined()
  })
})
