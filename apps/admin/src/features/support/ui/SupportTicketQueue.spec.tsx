/**
 * Component-тест `SupportTicketQueue` (DTJ-283, АС1: «просроченный тикет — ПЕРВЫМ, с красным
 * SlaBadge»).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { SupportTicketDto } from '@dorutj/contracts'
import { SupportTicketQueue } from './SupportTicketQueue'
import { renderWithProviders } from './test-utils'

const NOW = Date.now()
const MINUTES = 60_000

function ticket(overrides: Partial<SupportTicketDto> & { id: string }): SupportTicketDto {
  return {
    tenantId: 'tenant-1',
    orderId: null,
    channel: 'in_app',
    category: 'other',
    isEscrowBlocking: false,
    status: 'open',
    priority: 0,
    createdBy: 'customer-1',
    description: null,
    firstResponseDueAt: new Date(NOW + 60 * MINUTES).toISOString(),
    firstRespondedAt: null,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    messages: [],
    ...overrides,
  }
}

describe('SupportTicketQueue', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              data: [
                ticket({ id: 'ok-ticket', firstResponseDueAt: new Date(NOW + 90 * MINUTES).toISOString() }),
                ticket({ id: 'overdue-ticket', priority: 1, firstResponseDueAt: new Date(NOW - 5 * MINUTES).toISOString() }),
              ],
            }),
          ),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('АС1 — просроченный тикет отображается ПЕРВЫМ, с data-sla-state="overdue"', async () => {
    renderWithProviders(<SupportTicketQueue />)

    await waitFor(() => { expect(screen.getAllByTestId('support-ticket-row')).toHaveLength(2) })

    const rows = screen.getAllByTestId('support-ticket-row')
    expect(rows[0]).toHaveAttribute('data-ticket-id', 'overdue-ticket')
    const firstRowBadge = rows[0]?.querySelector('[data-testid="sla-badge"]')
    expect(firstRowBadge).toHaveAttribute('data-sla-state', 'overdue')
  })

  it('пустая очередь → сообщение "не найдено", без строк', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ data: [] })) }))
    renderWithProviders(<SupportTicketQueue />)

    await waitFor(() => { expect(screen.queryAllByTestId('support-ticket-row')).toHaveLength(0) })
  })
})
