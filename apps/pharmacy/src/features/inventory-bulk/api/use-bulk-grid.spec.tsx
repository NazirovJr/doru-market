import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { INVENTORY_LIST_QUERY_KEY } from '@/shared/api/inventory-query-keys'
import {
  BULK_GRID_PAGE_SIZE,
  flattenInventoryPages,
  isRowExpiryValid,
  isRowPriceValid,
  isRowQuantityValid,
  mergeServerAndLocalRows,
  paginateRows,
  selectDirtyRows,
  totalPageCount,
  useBulkSave,
  useInventoryList,
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

describe('mergeServerAndLocalRows (DTJ-171)', () => {
  it('серверные строки + локально добавленная (isDirty, нет на сервере) строка — обе присутствуют', () => {
    const serverRows = [makeRow({ rowId: 'srv-1', isDirty: false })]
    const localRow = makeRow({ rowId: 'local-1', isDirty: true })
    const result = mergeServerAndLocalRows(serverRows, [localRow])
    expect(result.map((row) => row.rowId)).toEqual(['srv-1', 'local-1'])
  })

  it('локальная строка, уже сохранённая (isDirty=false) и отсутствующая на сервере — отбрасывается', () => {
    const serverRows = [makeRow({ rowId: 'srv-1', isDirty: false })]
    const staleLocalRow = makeRow({ rowId: 'local-1', isDirty: false })
    const result = mergeServerAndLocalRows(serverRows, [staleLocalRow])
    expect(result.map((row) => row.rowId)).toEqual(['srv-1'])
  })

  it('строка с тем же rowId на сервере — серверная версия побеждает (не дублируется)', () => {
    const serverRows = [makeRow({ rowId: 'row-x', priceTjs: '99', isDirty: false })]
    const localRow = makeRow({ rowId: 'row-x', priceTjs: '1', isDirty: true })
    const result = mergeServerAndLocalRows(serverRows, [localRow])
    expect(result).toHaveLength(1)
    expect(result[0]?.priceTjs).toBe('99')
  })
})

describe('flattenInventoryPages (DTJ-171)', () => {
  it('data=undefined — пустой массив', () => {
    expect(flattenInventoryPages(undefined)).toEqual([])
  })

  it('несколько страниц — сплющивает items всех страниц по порядку, isDirty=false', () => {
    const data = {
      pages: [
        { items: [{ inventoryId: 'inv-1', medicineId: 'med-1', tradeName: 'A', dosageForm: 'tab', dosageStrength: '1mg', priceDiram: 1250, stockQuantity: 5, batchNumber: null, expiryDate: '2030-01-01', lastSyncedAt: '2026-01-01T00:00:00.000Z' }], nextCursor: 'c1' },
        { items: [{ inventoryId: 'inv-2', medicineId: 'med-2', tradeName: 'B', dosageForm: 'tab', dosageStrength: '2mg', priceDiram: 1, stockQuantity: 0, batchNumber: 'B-1', expiryDate: '2030-02-01', lastSyncedAt: '2026-01-02T00:00:00.000Z' }], nextCursor: null },
      ],
      pageParams: [null, 'c1'],
    }
    const result = flattenInventoryPages(data)
    expect(result).toEqual([
      { rowId: 'inv-1', medicineId: 'med-1', medicineLabel: 'A (tab, 1mg)', priceTjs: '12.50', quantity: '5', expiryDate: '2030-01-01', batchNumber: '', isDirty: false },
      { rowId: 'inv-2', medicineId: 'med-2', medicineLabel: 'B (tab, 2mg)', priceTjs: '0.01', quantity: '0', expiryDate: '2030-02-01', batchNumber: 'B-1', isDirty: false },
    ])
  })
})

describe('useInventoryList (DTJ-171)', () => {
  it('загружает страницу, парсит meta.pagination — hasNextPage=true, флаттенится в BulkGridRow', async () => {
    stubFetch((url) => {
      expect(url).toContain('/api/v1/inventory')
      expect(url).toContain('limit=50')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ inventoryId: 'inv-1', medicineId: 'med-1', tradeName: 'Aspirin', dosageForm: 'tab', dosageStrength: '500mg', priceDiram: 1000, stockQuantity: 3, batchNumber: null, expiryDate: '2030-01-01', lastSyncedAt: '2026-01-01T00:00:00.000Z' }],
            meta: { pagination: { nextCursor: 'cursor-1', hasMore: true, limit: 50 } },
          }),
          { status: 200 },
        ),
      )
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useInventoryList(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.hasNextPage).toBe(true)
    const rows = flattenInventoryPages(result.current.data)
    expect(rows).toEqual([
      { rowId: 'inv-1', medicineId: 'med-1', medicineLabel: 'Aspirin (tab, 500mg)', priceTjs: '10.00', quantity: '3', expiryDate: '2030-01-01', batchNumber: '', isDirty: false },
    ])
  })

  it('загружает вторую страницу через fetchNextPage с cursor из meta', async () => {
    const fetchMock = stubFetch((url) => {
      const hasCursor = url.includes('cursor=')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [],
            meta: { pagination: { nextCursor: hasCursor ? null : 'cursor-1', hasMore: !hasCursor, limit: 50 } },
          }),
          { status: 200 },
        ),
      )
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useInventoryList(), { wrapper: makeWrapper(queryClient) })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    void result.current.fetchNextPage()

    await waitFor(() => { expect(result.current.data?.pages).toHaveLength(2) })
    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit?]
    expect(secondCall[0]).toContain('cursor=cursor-1')
  })

  it('ошибка сервера — isError=true', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }), { status: 500 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useInventoryList(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    expect(result.current.error?.code).toBe('INTERNAL_ERROR')
  })
})
