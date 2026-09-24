import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventorySyncBatchListItemDto, InventorySyncBatchStatusDto } from '@dorutj/contracts'
import { SyncBatchesTable } from './SyncBatchesTable'

function batch(status: InventorySyncBatchStatusDto, overrides?: Partial<InventorySyncBatchListItemDto>): InventorySyncBatchListItemDto {
  return {
    batchId: `b-${status}`,
    channel: 'rest',
    syncType: 'delta',
    status,
    totalRows: 10,
    acceptedRows: 10,
    rejectedRows: 0,
    receivedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    sourceUploadId: null,
    ...overrides,
  }
}

function renderTable(items: readonly InventorySyncBatchListItemDto[]): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SyncBatchesTable items={items} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<SyncBatchesTable /> (DTJ-169)', () => {
  it('отображает статусные бейджи с корректным цветом по статусу', () => {
    renderTable([
      batch('completed_full_success'),
      batch('completed_partial_success', { rejectedRows: 3 }),
      batch('failed_validation', { rejectedRows: 10, acceptedRows: 0 }),
    ])

    expect(screen.getByTestId('sync-batch-status-b-completed_full_success')).toHaveClass('text-brand-success')
    expect(screen.getByTestId('sync-batch-status-b-completed_partial_success')).toHaveClass('text-brand-warning')
    expect(screen.getByTestId('sync-batch-status-b-failed_validation')).toHaveClass('text-brand-danger')
  })

  it('монтирование таблицы с батчами, у которых есть ошибки, НЕ вызывает fetch (ошибки грузятся только по раскрытию)', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderTable([batch('completed_partial_success', { rejectedRows: 12 }), batch('failed_validation', { rejectedRows: 5 })])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('пустой список — сообщение "нет синхронизаций", без таблицы', () => {
    renderTable([])

    expect(screen.getByTestId('sync-batches-table-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('sync-batches-table')).not.toBeInTheDocument()
  })
})
