/**
 * Unit-тест `support-ticket.mapper.ts` (EP-14, DTJ-282) — форма `SupportTicketDto`,
 * `isEscrowBlocking` литерал `false`, ISO-даты, `messages` по умолчанию `[]`.
 */
import { describe, expect, it } from 'vitest'
import type { SupportTicketListItem } from '@/modules/support/application/use-cases/list-support-tickets.use-case.js'
import type { SupportTicketMessageView } from '@/modules/support/application/use-cases/get-support-ticket.use-case.js'
import { toSupportTicketDto } from './support-ticket.mapper.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')

function listItem(): SupportTicketListItem {
  return {
    id: 'ticket-1',
    tenantId: 'tenant-1',
    orderId: null,
    channel: 'in_app',
    category: 'other',
    status: 'open',
    priority: 0,
    createdBy: 'customer-1',
    description: 'проблема',
    firstResponseDueAt: NOW,
    firstRespondedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('toSupportTicketDto', () => {
  it('без messages (список) → messages: [], даты — ISO-строки, isEscrowBlocking: false', () => {
    const dto = toSupportTicketDto(listItem())
    expect(dto.messages).toEqual([])
    expect(dto.isEscrowBlocking).toBe(false)
    expect(dto.createdAt).toBe(NOW.toISOString())
    expect(dto.firstResponseDueAt).toBe(NOW.toISOString())
    expect(dto.firstRespondedAt).toBeNull()
  })

  it('с messages (деталь) → маппит каждое сообщение, createdAt — ISO', () => {
    const message: SupportTicketMessageView = {
      id: 'message-1',
      ticketId: 'ticket-1',
      authorUserId: 'agent-1',
      authorRole: 'support_agent',
      body: 'ответ',
      createdAt: NOW,
    }
    const dto = toSupportTicketDto(listItem(), [message])
    expect(dto.messages).toEqual([
      { id: 'message-1', ticketId: 'ticket-1', authorUserId: 'agent-1', authorRole: 'support_agent', body: 'ответ', createdAt: NOW.toISOString() },
    ])
  })
})
