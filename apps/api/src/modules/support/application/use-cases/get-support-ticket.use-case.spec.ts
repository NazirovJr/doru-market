/**
 * Unit-тест `GetSupportTicketUseCase` (EP-14, DTJ-282) — `TicketNotFoundError`/`ForbiddenError`
 * (владение + межтенантная изоляция, см. JSDoc `SupportTicketsPolicy`), маппинг сообщений.
 */
import { ForbiddenError } from '@dorutj/contracts'
import { describe, expect, it, vi } from 'vitest'
import { SupportTicket, SupportTicketMessage, TicketNotFoundError } from '../../domain/index.js'
import { SupportTicketCategory } from '../../domain/value-objects/support-ticket-category.vo.js'
import type { SupportTicketsRepositoryPort } from '../ports/support-tickets-repository.port.js'
import type { SupportTicketsPolicyActor } from '../support-tickets.policy.js'
import { GetSupportTicketUseCase } from './get-support-ticket.use-case.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OWNER_ID = 'customer-1'

function ticket(): SupportTicket {
  return SupportTicket.restore({
    id: 'ticket-1',
    tenantId: TENANT_ID,
    orderId: null,
    channel: 'in_app',
    category: SupportTicketCategory.fromTrusted('other'),
    status: 'open',
    priority: 0,
    createdBy: OWNER_ID,
    description: null,
    firstResponseDueAt: NOW,
    firstRespondedAt: null,
    lastEscalatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

function message(): SupportTicketMessage {
  return SupportTicketMessage.restore({
    id: 'message-1',
    ticketId: 'ticket-1',
    authorUserId: OWNER_ID,
    authorRole: 'customer',
    body: 'hello',
    createdAt: NOW,
  })
}

function actor(role: SupportTicketsPolicyActor['role'], userId: string, tenantId: string = TENANT_ID): SupportTicketsPolicyActor {
  return { role, userId, tenantId }
}

function buildHarness(foundTicket: SupportTicket | null) {
  const repository: SupportTicketsRepositoryPort = {
    save: vi.fn(),
    findById: vi.fn().mockResolvedValue(foundTicket),
    list: vi.fn(),
    saveMessage: vi.fn(),
    listMessagesByTicketId: vi.fn().mockResolvedValue([message()]),
  }
  return { useCase: new GetSupportTicketUseCase(repository), repository }
}

describe('GetSupportTicketUseCase', () => {
  it('тикет не найден → TicketNotFoundError', async () => {
    const { useCase } = buildHarness(null)
    await expect(useCase.execute({ ticketId: 'missing', actor: actor('customer', OWNER_ID) })).rejects.toBeInstanceOf(TicketNotFoundError)
  })

  it('владелец (свой тенант) → детальный вид с сообщениями', async () => {
    const { useCase } = buildHarness(ticket())
    const result = await useCase.execute({ ticketId: 'ticket-1', actor: actor('customer', OWNER_ID) })
    expect(result.id).toBe('ticket-1')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({ id: 'message-1', body: 'hello', authorRole: 'customer' })
  })

  it('другой customer (не владелец) → ForbiddenError', async () => {
    const { useCase } = buildHarness(ticket())
    await expect(useCase.execute({ ticketId: 'ticket-1', actor: actor('customer', 'other-customer') })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('support_agent СВОЕГО тенанта → допущен', async () => {
    const { useCase } = buildHarness(ticket())
    const result = await useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1') })
    expect(result.id).toBe('ticket-1')
  })

  it('support_agent ЧУЖОГО тенанта → ForbiddenError (DTJ-282 межтенантная изоляция)', async () => {
    const { useCase } = buildHarness(ticket())
    await expect(
      useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1', 'tenant-2') }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
