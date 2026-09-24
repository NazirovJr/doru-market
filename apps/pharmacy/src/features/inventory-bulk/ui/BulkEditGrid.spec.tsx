import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BulkEditGrid } from './BulkEditGrid'

function renderGrid(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BulkEditGrid />
    </QueryClientProvider>,
  )
}

function stubMedicineSearch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ data: [{ medicineId: 'med-1', tradeName: 'Aspirin', dosageForm: 'tablet', dosageStrength: '500mg' }] }),
        { status: 200 },
      ),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function addOneRow(): Promise<void> {
  fireEvent.click(screen.getByTestId('bulk-grid-add-row-button'))
  fireEvent.change(screen.getByTestId('bulk-grid-medicine-picker-input'), { target: { value: 'asp' } })
  await waitFor(() => { expect(screen.getByTestId('bulk-grid-medicine-picker-option')).toBeInTheDocument() })
  fireEvent.click(screen.getByTestId('bulk-grid-medicine-picker-option'))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<BulkEditGrid /> (DTJ-168)', () => {
  it('пустая сетка показывает состояние "нет строк"', () => {
    renderGrid()
    expect(screen.getByTestId('bulk-grid-empty')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-grid-save-button')).toBeDisabled()
  })

  it('добавление строки через выбор медикамента делает её видимой и readonly по названию', async () => {
    stubMedicineSearch()
    renderGrid()

    await addOneRow()

    expect(screen.queryByTestId('bulk-grid-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('bulk-grid-row')).toBeInTheDocument()
    expect(screen.getByText('Aspirin (tablet, 500mg)')).toBeInTheDocument()
  })

  it('«Сохранить» отправляет только изменённые строки (АС5)', async () => {
    stubMedicineSearch()
    renderGrid()
    await addOneRow()

    fireEvent.change(screen.getByTestId('bulk-grid-price-input'), { target: { value: '15' } })
    fireEvent.change(screen.getByTestId('bulk-grid-quantity-input'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('bulk-grid-expiry-input'), { target: { value: '2030-01-01' } })

    expect(screen.getByTestId('bulk-grid-save-button')).not.toBeDisabled()

    const saveMock = vi.fn((input: string, _init?: RequestInit) => {
      if (input.includes('medicines/search')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ medicineId: 'med-1', tradeName: 'Aspirin', dosageForm: 'tablet', dosageStrength: '500mg' }] }), { status: 200 }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: { batchId: 'batch-1', status: 'completed', acceptedRows: 1, rejectedRows: 0, errors: [] } }), { status: 200 }),
      )
    })
    vi.stubGlobal('fetch', saveMock)

    fireEvent.click(screen.getByTestId('bulk-grid-save-button'))

    await waitFor(() => { expect(screen.getByTestId('bulk-grid-save-success')).toBeInTheDocument() })

    const saveCall = saveMock.mock.calls.find(([url]) => url.includes('inventory-manual-entry'))
    expect(saveCall).toBeDefined()
    const [, init] = saveCall as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { rows: readonly unknown[] }
    expect(body.rows).toHaveLength(1)
  })

  it('удаление строки убирает её из сетки', async () => {
    stubMedicineSearch()
    renderGrid()
    await addOneRow()

    fireEvent.click(screen.getByTestId('bulk-grid-remove-row'))

    expect(screen.getByTestId('bulk-grid-empty')).toBeInTheDocument()
  })
})
