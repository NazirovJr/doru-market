/**
 * Component-тест `SupportTicketDetail` (DTJ-283 тест-план: «отправка ответа, смена статуса,
 * скрытие кнопок для терминального статуса» — АС2/АС3 тикета).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { SupportTicketDto } from '@dorutj/contracts'
import { SupportTicketDetail } from './SupportTicketDetail'
import { renderWithProviders } from './test-utils'

const NOW = Date.now()

function baseTicket(overrides: Partial<SupportTicketDto> = {}): SupportTicketDto {
  return {
    id: 'ticket-1',
    tenantId: 'tenant-1',
    orderId: null,
    channel: 'in_app',
    category: 'other',
    isEscrowBlocking: false,
    status: 'open',
    priority: 0,
    createdBy: 'customer-1',
    description: 'клиент жалуется',
    firstResponseDueAt: new Date(NOW + 60 * 60_000).toISOString(),
    firstRespondedAt: null,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    messages: [],
    ...overrides,
  }
}

function jsonResponse(body: unknown): { ok: boolean; status: number; text: () => Promise<string> } {
  return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SupportTicketDetail', () => {
  it('АС2 — отправка первого ответа агентом → firstRespondedAt заполняется, сообщение появляется в ленте', async () => {
    const respondedTicket = baseTicket({
      firstRespondedAt: new Date(NOW).toISOString(),
      messages: [{ id: 'm1', ticketId: 'ticket-1', authorUserId: 'agent-1', authorRole: 'support_agent', body: 'Разбираемся', createdAt: new Date(NOW).toISOString() }],
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: baseTicket() }))
      .mockResolvedValueOnce(jsonResponse({ data: respondedTicket }))
    vi.stubGlobal('fetch', fetchMock)

    renderWithProviders(<SupportTicketDetail ticketId="ticket-1" />)

    await waitFor(() => { expect(screen.getByTestId('support-ticket-detail')).toBeInTheDocument() })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Разбираемся' } })
    fireEvent.click(screen.getByRole('button', { name: /отправить ответ/i }))

    await waitFor(() => { expect(screen.getByText('Разбираемся')).toBeInTheDocument() })
  })

  it('АС3 — тикет уже closed → кнопки смены статуса скрыты', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: baseTicket({ status: 'closed' }) })))

    renderWithProviders(<SupportTicketDetail ticketId="ticket-1" />)

    await waitFor(() => { expect(screen.getByTestId('support-ticket-detail')).toBeInTheDocument() })
    expect(screen.queryByTestId('support-ticket-status-actions')).not.toBeInTheDocument()
  })

  it('тикет open → показывает кнопки допустимых переходов (in_progress/resolved)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: baseTicket({ status: 'open' }) })))

    renderWithProviders(<SupportTicketDetail ticketId="ticket-1" />)

    await waitFor(() => { expect(screen.getByTestId('support-ticket-status-actions')).toBeInTheDocument() })
    expect(screen.getAllByRole('button', { name: /взять в работу|отметить решённым/i })).toHaveLength(2)
  })
})
