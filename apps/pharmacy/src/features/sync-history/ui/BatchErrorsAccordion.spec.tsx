import { useState, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventorySyncBatchListItemDto } from '@dorutj/contracts'
import { BatchErrorsAccordion } from './BatchErrorsAccordion'

function batch(overrides?: Partial<InventorySyncBatchListItemDto>): InventorySyncBatchListItemDto {
  return {
    batchId: 'b1',
    channel: 'rest',
    syncType: 'delta',
    status: 'completed_partial_success',
    totalRows: 12,
    acceptedRows: 0,
    rejectedRows: 12,
    receivedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    sourceUploadId: null,
    ...overrides,
  }
}

function errorsResponse(count: number): Response {
  const rows = Array.from({ length: count }, (_, index) => ({
    rowIndex: index,
    errorCode: 'invalid_price',
    message: `Строка ${String(index)}: некорректная цена`,
    rawRow: null,
  }))
  return new Response(JSON.stringify({ data: rows }), { status: 200 })
}

/** Toggle-состояние живёт в тестовом хосте — сам `BatchErrorsAccordion` не хранит `isOpen` (controlled). */
const AccordionHarness = ({ item }: { readonly item: InventorySyncBatchListItemDto }): ReactElement => {
  const [isOpen, setIsOpen] = useState(false)
  return <BatchErrorsAccordion batch={item} isOpen={isOpen} onToggle={() => { setIsOpen((value) => !value) }} />
}

function renderAccordion(item: InventorySyncBatchListItemDto): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AccordionHarness item={item} />
    </QueryClientProvider>,
  )
}

function toggle(batchId: string): void {
  fireEvent.click(screen.getByTestId(`batch-errors-toggle-${batchId}`))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<BatchErrorsAccordion /> (DTJ-169, критерий приёмки 2)', () => {
  it('НЕ грузит ошибки при монтировании — только при раскрытии строки', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(errorsResponse(12)))
    vi.stubGlobal('fetch', fetchMock)

    renderAccordion(batch())

    expect(fetchMock).not.toHaveBeenCalled()

    toggle('b1')

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.getAllByTestId('batch-error-row')).toHaveLength(12) })
  })

  it('кнопка отчёта видна для батча с sourceUploadId и ошибками (Excel-канал, DTJ-164)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errorsResponse(1))))
    renderAccordion(batch({ channel: 'excel', sourceUploadId: 'up-1' }))

    toggle('b1')

    await waitFor(() => { expect(screen.getByTestId('batch-download-error-report-b1')).toBeInTheDocument() })
  })

  it('кнопка отчёта ОТСУТСТВУЕТ для REST-батча (1С, sourceUploadId=null, SRS-INV-045)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(errorsResponse(1))))
    renderAccordion(batch({ channel: 'rest', sourceUploadId: null }))

    toggle('b1')

    await waitFor(() => { expect(screen.getAllByTestId('batch-error-row')).toHaveLength(1) })
    expect(screen.queryByTestId('batch-download-error-report-b1')).not.toBeInTheDocument()
  })
})
