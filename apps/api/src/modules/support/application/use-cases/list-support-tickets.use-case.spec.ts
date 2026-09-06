/**
 * Unit-тест `ListSupportTicketsUseCase` (EP-14, DTJ-282, тест-план тикета: «пагинация — курсор
 * корректно продвигается, фильтры комбинируются»).
 */
import { describe, expect, it, vi } from 'vitest'
import { SupportTicket } from '../../domain/index.js'
import { SupportTicketCategory } from '../../domain/value-objects/support-ticket-category.vo.js'
import type { SupportTicketsRepositoryPort } from '../ports/support-tickets-repository.port.js'
import type { SupportTicketsPolicyActor } from '../support-tickets.policy.js'
import { ListSupportTicketsUseCase } from './list-support-tickets.use-case.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const TENANT_ID = 'tenant-1'

function ticket(createdBy: string): SupportTicket {
  return SupportTicket.restore({
    id: 'ticket-1',
    tenantId: TENANT_ID,
    orderId: null,
    channel: 'in_app',
    category: SupportTicketCategory.fromTrusted('other'),
    status: 'open',
    priority: 0,
    createdBy,
    description: null,
    firstResponseDueAt: NOW,
    firstRespondedAt: null,
    lastEscalatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  })
}

function actor(role: SupportTicketsPolicyActor['role'], userId: string): SupportTicketsPolicyActor {
  return { role, userId, tenantId: TENANT_ID }
}

function buildHarness() {
  const listMock = vi.fn<SupportTicketsRepositoryPort['list']>().mockResolvedValue({
    items: [ticket('customer-1')],
    nextCursor: { v: '2026-09-04', id: 'ticket-1' },
    hasMore: true,
  })
  const repository: SupportTicketsRepositoryPort = {
    save: vi.fn(),
    findById: vi.fn(),
    list: listMock,
    saveMessage: vi.fn(),
    listMessagesByTicketId: vi.fn(),
  }
  const useCase = new ListSupportTicketsUseCase(repository)
  return { useCase, listMock }
}

describe('ListSupportTicketsUseCase', () => {
  it('support_agent (staff) → repository.list БЕЗ createdBy (видит все тикеты тенанта)', async () => {
    const { useCase, listMock } = buildHarness()
    await useCase.execute({ actor: actor('support_agent', 'agent-1'), limit: 20 })
    // Точное совпадение (не objectContaining) — доказывает ОТСУТСТВИЕ ключа `createdBy` целиком,
    // не только «неопределённое значение» (staff видит ВСЕ тикеты тенанта, без скоупа по владельцу).
    expect(listMock.mock.calls[0]?.[0]).toEqual({ tenantId: TENANT_ID, limit: 20, cursor: null })
  })

  it('customer (не staff) → repository.list С createdBy = actor.userId (скоуп «только свои»)', async () => {
    const { useCase, listMock } = buildHarness()
    await useCase.execute({ actor: actor('customer', 'customer-1'), limit: 20 })
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'customer-1' }))
  })

  it('фильтры status/category/priority передаются в repository.list, только если заданы', async () => {
    const { useCase, listMock } = buildHarness()
    await useCase.execute({ actor: actor('support_agent', 'agent-1'), limit: 20, status: 'open', category: 'other', priority: 1 })
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'open', category: 'other', priority: 1 }))
  })

  it('курсор из command передаётся repository.list как есть, результат маппится в SupportTicketListItem + nextCursor/hasMore проброшены', async () => {
    const { useCase, listMock } = buildHarness()
    const cursor = { v: '2026-09-01', id: 'anchor' }
    const result = await useCase.execute({ actor: actor('support_agent', 'agent-1'), limit: 20, cursor })
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ cursor }))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'ticket-1', tenantId: TENANT_ID, category: 'other', channel: 'in_app', status: 'open' })
    expect(result.nextCursor).toEqual({ v: '2026-09-04', id: 'ticket-1' })
    expect(result.hasMore).toBe(true)
  })
})
