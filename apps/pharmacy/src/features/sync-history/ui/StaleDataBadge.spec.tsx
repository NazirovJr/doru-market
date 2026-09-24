import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { InventorySyncBatchListItemDto } from '@dorutj/contracts'
import { StaleDataBadge } from './StaleDataBadge'

function freshBatch(overrides?: Partial<InventorySyncBatchListItemDto>): InventorySyncBatchListItemDto {
  return {
    batchId: 'b1',
    channel: 'rest',
    syncType: 'delta',
    status: 'completed_full_success',
    totalRows: 10,
    acceptedRows: 10,
    rejectedRows: 0,
    receivedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    sourceUploadId: null,
    ...overrides,
  }
}

describe('<StaleDataBadge /> (DTJ-169, критерий приёмки 5)', () => {
  it('акцентирует предупреждение, когда свежесть 1С-батча превышает INVENTORY_DELTA_SLA_MINUTES', () => {
    const receivedAt = '2026-01-01T00:00:00.000Z'
    const now = new Date('2026-01-01T03:00:00.000Z') // 3 часа спустя, порог для REST — 5 минут

    render(<StaleDataBadge freshestBatch={freshBatch({ receivedAt })} now={now} />)

    const badge = screen.getByTestId('stale-data-badge')
    expect(badge.dataset.stale).toBe('true')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(badge).toHaveTextContent('3')
  })

  it('не акцентирует предупреждение, когда синхронизация в пределах порога', () => {
    const receivedAt = '2026-01-01T00:00:00.000Z'
    const now = new Date('2026-01-01T00:02:00.000Z') // 2 минуты спустя, порог REST — 5 минут

    render(<StaleDataBadge freshestBatch={freshBatch({ receivedAt })} now={now} />)

    expect(screen.getByTestId('stale-data-badge').dataset.stale).toBe('false')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('без единого батча — нейтральное сообщение, не предупреждение', () => {
    render(<StaleDataBadge freshestBatch={null} />)

    expect(screen.getByTestId('stale-data-badge-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('stale-data-badge')).not.toBeInTheDocument()
  })
})
