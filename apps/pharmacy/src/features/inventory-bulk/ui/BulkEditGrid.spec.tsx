import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BULK_GRID_PAGE_SIZE } from '@/features/inventory-bulk/api/use-bulk-grid'
import { BulkEditGrid } from './BulkEditGrid'

const DEFAULT_MEDICINE_SEARCH_ITEM = { medicineId: 'med-1', tradeName: 'Aspirin', dosageForm: 'tablet', dosageStrength: '500mg' }
const DEFAULT_SAVE_RESPONSE = { batchId: 'batch-1', status: 'completed', acceptedRows: 1, rejectedRows: 0, errors: [] }

interface InventoryItemFixture {
  readonly inventoryId: string
  readonly medicineId: string
  readonly tradeName: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly priceDiram: number
  readonly stockQuantity: number
  readonly batchNumber: string | null
  readonly expiryDate: string
  readonly lastSyncedAt: string
}

const INVENTORY_ITEM_1: InventoryItemFixture = {
  inventoryId: 'inv-1', medicineId: 'med-1', tradeName: 'Aspirin', dosageForm: 'tablet', dosageStrength: '500mg',
  priceDiram: 1000, stockQuantity: 5, batchNumber: null, expiryDate: '2030-01-01', lastSyncedAt: '2026-01-01T00:00:00.000Z',
}
const INVENTORY_ITEM_2: InventoryItemFixture = {
  inventoryId: 'inv-2', medicineId: 'med-2', tradeName: 'Paracetamol', dosageForm: 'tablet', dosageStrength: '200mg',
  priceDiram: 500, stockQuantity: 10, batchNumber: null, expiryDate: '2030-02-01', lastSyncedAt: '2026-01-01T00:00:00.000Z',
}

function renderGrid(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BulkEditGrid />
    </QueryClientProvider>,
  )
}

interface InventoryPageFixture {
  readonly items: readonly InventoryItemFixture[]
  readonly hasMore: boolean
}

interface StubApiOptions {
  readonly medicineSearchItems?: readonly (typeof DEFAULT_MEDICINE_SEARCH_ITEM)[]
  readonly inventoryItems?: readonly InventoryItemFixture[]
  readonly inventoryPages?: readonly InventoryPageFixture[]
  readonly saveResponse?: Record<string, unknown>
}

function makeInventoryItems(count: number, offset = 0): InventoryItemFixture[] {
  return Array.from({ length: count }, (_, i) => ({
    inventoryId: `inv-${String(offset + i)}`,
    medicineId: `med-${String(offset + i)}`,
    tradeName: `Trade-${String(offset + i).padStart(4, '0')}`,
    dosageForm: 'tablet',
    dosageStrength: '10mg',
    priceDiram: 100,
    stockQuantity: 1,
    batchNumber: null,
    expiryDate: '2030-01-01',
    lastSyncedAt: '2026-01-01T00:00:00.000Z',
  }))
}

// Различает URL — /medicines/search (подсказки), /inventory-manual-entry (сохранение, ПЕРЕД
// общим /inventory — иначе матчится по префиксу), /inventory (список остатков, DTJ-171,
// многостраничный фикстур через inventoryPages — по счётчику вызовов).
function stubApi(options: StubApiOptions = {}): ReturnType<typeof vi.fn> {
  const medicineSearchItems = options.medicineSearchItems ?? [DEFAULT_MEDICINE_SEARCH_ITEM]
  const inventoryPages = options.inventoryPages ?? [{ items: options.inventoryItems ?? [], hasMore: false }]
  const saveResponse = options.saveResponse ?? DEFAULT_SAVE_RESPONSE
  let inventoryCallCount = 0

  const fetchMock = vi.fn((input: string, _init?: RequestInit) => {
    if (input.includes('/api/v1/medicines/search')) {
      return Promise.resolve(new Response(JSON.stringify({ data: medicineSearchItems }), { status: 200 }))
    }
    if (input.includes('/api/v1/inventory-manual-entry')) {
      return Promise.resolve(new Response(JSON.stringify({ data: saveResponse }), { status: 200 }))
    }
    if (input.includes('/api/v1/inventory')) {
      const page = inventoryPages[Math.min(inventoryCallCount, inventoryPages.length - 1)]!
      inventoryCallCount += 1
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: page.items,
            meta: { pagination: { nextCursor: page.hasMore ? 'cursor-1' : null, hasMore: page.hasMore, limit: 50 } },
          }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `unstubbed path: ${input}` } }), { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function countInventoryListCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return (fetchMock.mock.calls as [string, RequestInit?][]).filter(
    ([url]) => url.includes('/api/v1/inventory') && !url.includes('inventory-manual-entry'),
  ).length
}

async function addOneRow(): Promise<void> {
  fireEvent.click(screen.getByTestId('bulk-grid-add-row-button'))
  fireEvent.change(screen.getByTestId('bulk-grid-medicine-picker-input'), { target: { value: 'asp' } })
  await waitFor(() => { expect(screen.getByTestId('bulk-grid-medicine-picker-option')).toBeInTheDocument() })
  fireEvent.click(screen.getByTestId('bulk-grid-medicine-picker-option'))
}

function findSaveCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const saveCall = (fetchMock.mock.calls as [string, RequestInit][]).find(([url]) => url.includes('inventory-manual-entry'))
  expect(saveCall).toBeDefined()
  return saveCall!
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<BulkEditGrid /> (DTJ-168)', () => {
  it('пустая сетка показывает состояние "нет строк"', () => {
    stubApi()
    renderGrid()
    expect(screen.getByTestId('bulk-grid-empty')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-grid-save-button')).toBeDisabled()
  })

  it('добавление строки через выбор медикамента делает её видимой и readonly по названию', async () => {
    stubApi()
    renderGrid()

    await addOneRow()

    expect(screen.queryByTestId('bulk-grid-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('bulk-grid-row')).toBeInTheDocument()
    expect(screen.getByText('Aspirin (tablet, 500mg)')).toBeInTheDocument()
  })

  it('«Сохранить» отправляет только изменённые строки (АС5)', async () => {
    const fetchMock = stubApi()
    renderGrid()
    await addOneRow()

    fireEvent.change(screen.getByTestId('bulk-grid-price-input'), { target: { value: '15' } })
    fireEvent.change(screen.getByTestId('bulk-grid-quantity-input'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('bulk-grid-expiry-input'), { target: { value: '2030-01-01' } })

    expect(screen.getByTestId('bulk-grid-save-button')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('bulk-grid-save-button'))

    await waitFor(() => { expect(screen.getByTestId('bulk-grid-save-success')).toBeInTheDocument() })

    const [, init] = findSaveCall(fetchMock)
    const body = JSON.parse(init.body as string) as { rows: readonly unknown[] }
    expect(body.rows).toHaveLength(1)
  })

  it('удаление строки убирает её из сетки', async () => {
    stubApi()
    renderGrid()
    await addOneRow()

    fireEvent.click(screen.getByTestId('bulk-grid-remove-row'))

    expect(screen.getByTestId('bulk-grid-empty')).toBeInTheDocument()
  })

  it('критерий 6 (DTJ-171): список остатков загружен с сервера, изменена цена у 2 строк — «Сохранить» шлёт ровно 2 строки', async () => {
    const fetchMock = stubApi({ inventoryItems: [INVENTORY_ITEM_1, INVENTORY_ITEM_2] })
    renderGrid()

    await waitFor(() => { expect(screen.getAllByTestId('bulk-grid-row')).toHaveLength(2) })
    expect(screen.getByText('Aspirin (tablet, 500mg)')).toBeInTheDocument()
    expect(screen.getByText('Paracetamol (tablet, 200mg)')).toBeInTheDocument()

    const priceInputs = screen.getAllByTestId('bulk-grid-price-input')
    fireEvent.change(priceInputs[0]!, { target: { value: '11.00' } })
    fireEvent.change(priceInputs[1]!, { target: { value: '6.00' } })

    await waitFor(() => { expect(screen.getByTestId('bulk-grid-save-button')).not.toBeDisabled() })
    fireEvent.click(screen.getByTestId('bulk-grid-save-button'))

    await waitFor(() => { expect(screen.getByTestId('bulk-grid-save-success')).toBeInTheDocument() })

    const [, init] = findSaveCall(fetchMock)
    const body = JSON.parse(init.body as string) as { rows: readonly { medicineId: string }[] }
    expect(body.rows).toHaveLength(2)
    expect(body.rows.map((row) => row.medicineId).sort()).toEqual(['med-1', 'med-2'])
  })

  it('при монтировании ровно 1 запрос GET /inventory — без эагерной подгрузки всех страниц', async () => {
    const fetchMock = stubApi({ inventoryPages: [{ items: makeInventoryItems(1), hasMore: true }] })
    renderGrid()

    await waitFor(() => { expect(screen.getAllByTestId('bulk-grid-row')).toHaveLength(1) })
    expect(countInventoryListCalls(fetchMock)).toBe(1)
  })

  it('переход на страницу 2 при hasNextPage=true отправляет второй запрос GET /inventory', async () => {
    const fetchMock = stubApi({
      inventoryPages: [
        { items: makeInventoryItems(BULK_GRID_PAGE_SIZE, 0), hasMore: true },
        { items: makeInventoryItems(1, BULK_GRID_PAGE_SIZE), hasMore: false },
      ],
    })
    renderGrid()

    await waitFor(() => { expect(screen.getAllByTestId('bulk-grid-row')).toHaveLength(BULK_GRID_PAGE_SIZE) })
    expect(countInventoryListCalls(fetchMock)).toBe(1)
    expect(screen.getByTestId('bulk-grid-next-page')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('bulk-grid-next-page'))

    await waitFor(() => { expect(countInventoryListCalls(fetchMock)).toBe(2) })
  })
})
