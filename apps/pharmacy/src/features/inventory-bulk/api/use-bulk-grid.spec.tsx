import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { INVENTORY_LIST_QUERY_KEY } from '@/shared/api/inventory-query-keys'
import {
  BULK_GRID_PAGE_SIZE,
  isRowExpiryValid,
  isRowPriceValid,
  isRowQuantityValid,
  paginateRows,
  selectDirtyRows,
  totalPageCount,
  useBulkSave,
  type BulkGridRow,
} from './use-bulk-grid'

function makeRow(overrides: Partial<BulkGridRow> = {}): BulkGridRow {
  return {
    rowId: 'row-1',
    medicineId: 'med-1',
    medicineLabel: 'Aspirin',
    priceTjs: '10',
    quantity: '5',
    expiryDate: '2030-01-01',
    batchNumber: '',
    isDirty: false,
    ...overrides,
  }
}

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

const ROWS: readonly BulkGridRow[] = [
  { rowId: 'r1', medicineId: 'med-1', medicineLabel: 'A', priceTjs: '10', quantity: '5', expiryDate: '2030-01-01', batchNumber: '', isDirty: true },
  { rowId: 'r2', medicineId: 'med-2', medicineLabel: 'B', priceTjs: '20', quantity: '1', expiryDate: '2030-02-01', batchNumber: 'B-1', isDirty: true },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useBulkSave (DTJ-168)', () => {
  it('успех: POST со ВСЕМИ переданными (уже отфильтрованными как dirty) строками, инвалидирует INVENTORY_LIST_QUERY_KEY', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { batchId: 'batch-1', status: 'completed', acceptedRows: 2, rejectedRows: 0, errors: [] } }),
          { status: 200 },
        ),
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useBulkSave(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate(ROWS)

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data?.acceptedRows).toBe(2)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/inventory-manual-entry')
    const body = JSON.parse(init.body as string) as { rows: readonly unknown[] }
    expect(body.rows).toHaveLength(2)
    expect(body.rows[1]).toEqual({ medicineId: 'med-2', priceTjs: 20, quantity: 1, expiryDate: '2030-02-01', op: 'upsert', batchNumber: 'B-1' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: INVENTORY_LIST_QUERY_KEY })
  })

  it('ошибка сервера — isError=true', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'bad rows' } }), { status: 400 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

    const { result } = renderHook(() => useBulkSave(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate(ROWS)

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    expect(result.current.error?.code).toBe('VALIDATION_ERROR')
  })
})

describe('selectDirtyRows', () => {
  it('80 строк, 3 изменены — возвращает ровно эти 3', () => {
    const rows = Array.from({ length: 80 }, (_, index) => makeRow({ rowId: `row-${String(index)}`, isDirty: index < 3 }))
    const dirty = selectDirtyRows(rows)
    expect(dirty).toHaveLength(3)
    expect(dirty.every((row) => row.isDirty)).toBe(true)
  })

  it('ни одна строка не изменена — пустой массив', () => {
    const rows = [makeRow({ isDirty: false }), makeRow({ rowId: 'row-2', isDirty: false })]
    expect(selectDirtyRows(rows)).toEqual([])
  })
})

describe('paginateRows / totalPageCount', () => {
  it('80 строк по 50 на страницу — 2 страницы, вторая содержит 30 строк', () => {
    const rows = Array.from({ length: 80 }, (_, index) => makeRow({ rowId: `row-${String(index)}` }))
    expect(totalPageCount(rows.length, BULK_GRID_PAGE_SIZE)).toBe(2)
    expect(paginateRows(rows, 0, BULK_GRID_PAGE_SIZE)).toHaveLength(50)
    expect(paginateRows(rows, 1, BULK_GRID_PAGE_SIZE)).toHaveLength(30)
  })

  it('0 строк — 1 страница (не 0), пустой срез', () => {
    expect(totalPageCount(0, BULK_GRID_PAGE_SIZE)).toBe(1)
    expect(paginateRows([], 0, BULK_GRID_PAGE_SIZE)).toEqual([])
  })
})

describe('isRowPriceValid / isRowQuantityValid / isRowExpiryValid', () => {
  it('цена <= 0 невалидна, > 0 валидна', () => {
    expect(isRowPriceValid('0')).toBe(false)
    expect(isRowPriceValid('-5')).toBe(false)
    expect(isRowPriceValid('10.5')).toBe(true)
  })

  it('остаток — целое неотрицательное', () => {
    expect(isRowQuantityValid('-1')).toBe(false)
    expect(isRowQuantityValid('1.5')).toBe(false)
    expect(isRowQuantityValid('0')).toBe(true)
  })

  it('срок годности не может быть в прошлом', () => {
    expect(isRowExpiryValid('2020-01-01', '2026-01-01')).toBe(false)
    expect(isRowExpiryValid('2027-01-01', '2026-01-01')).toBe(true)
  })
})
