/**
 * Unit-тест `AddSupportTicketMessageUseCase` (EP-14, DTJ-282) — владелец ИЛИ staff СВОЕГО
 * тенанта (два разных условия допуска, см. JSDoc use case'а), атомарность `saveMessage`+`save`.
 */
import { ForbiddenError } from '@dorutj/contracts'
import { describe, expect, it, vi } from 'vitest'
import { SupportTicket, TicketNotFoundError } from '../../domain/index.js'
import { SupportTicketCategory } from '../../domain/value-objects/support-ticket-category.vo.js'
import type { SupportTicketsRepositoryPort } from '../ports/support-tickets-repository.port.js'
import type { SupportUnitOfWorkPort, SupportUnitOfWorkTx } from '../ports/support-unit-of-work.port.js'
import type { SupportTicketsPolicyActor } from '../support-tickets.policy.js'
import { AddSupportTicketMessageUseCase } from './add-support-ticket-message.use-case.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OWNER_ID = 'customer-1'
const TX_MARKER = { marker: 'tx' } as SupportUnitOfWorkTx

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

function actor(role: SupportTicketsPolicyActor['role'], userId: string, tenantId: string = TENANT_ID): SupportTicketsPolicyActor {
  return { role, userId, tenantId }
}

function buildHarness(foundTicket: SupportTicket | null) {
  const callOrder: string[] = []
  const saveMessageMock = vi.fn((_message: unknown, _tx: SupportUnitOfWorkTx) => {
    callOrder.push('saveMessage')
    return Promise.resolve()
  })
  const saveMock = vi.fn((_t: SupportTicket, _tx: SupportUnitOfWorkTx) => {
    callOrder.push('save')
    return Promise.resolve()
  })
  const listMessagesByTicketIdMock = vi.fn().mockResolvedValue([])
  const repository: SupportTicketsRepositoryPort = {
    save: saveMock,
    findById: vi.fn().mockResolvedValue(foundTicket),
    list: vi.fn(),
    saveMessage: saveMessageMock,
    listMessagesByTicketId: listMessagesByTicketIdMock,
  }
  const unitOfWork: SupportUnitOfWorkPort = { run: (cb) => cb(TX_MARKER) }
  const ids = { next: () => 'message-1' }
  const clock = { now: () => NOW }
  const useCase = new AddSupportTicketMessageUseCase(repository, unitOfWork, ids, clock)
  return { useCase, saveMock, saveMessageMock, listMessagesByTicketIdMock, callOrder }
}

describe('AddSupportTicketMessageUseCase', () => {
  it('тикет не найден → TicketNotFoundError', async () => {
    const { useCase } = buildHarness(null)
    await expect(
      useCase.execute({ ticketId: 'missing', actor: actor('customer', OWNER_ID), body: 'hi' }),
    ).rejects.toBeInstanceOf(TicketNotFoundError)
  })

  it('владелец (customer) → допущен, saveMessage ДО save (атомарно внутри unitOfWork)', async () => {
    const { useCase, saveMessageMock, saveMock, callOrder } = buildHarness(ticket())
    await useCase.execute({ ticketId: 'ticket-1', actor: actor('customer', OWNER_ID), body: 'моя проблема' })
    expect(saveMessageMock).toHaveBeenCalledTimes(1)
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['saveMessage', 'save'])
  })

  it('другой customer (не владелец, не staff) → ForbiddenError', async () => {
    const { useCase } = buildHarness(ticket())
    await expect(
      useCase.execute({ ticketId: 'ticket-1', actor: actor('customer', 'other-customer'), body: 'hi' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('support_agent СВОЕГО тенанта (не владелец) → допущен, первое сообщение фиксирует firstRespondedAt', async () => {
    const { useCase, saveMock } = buildHarness(ticket())
    const result = await useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1'), body: 'Ответ агента' })
    expect(result.firstRespondedAt).toEqual(NOW)
    const savedTicket = saveMock.mock.calls[0]![0]
    expect(savedTicket.firstRespondedAt).toEqual(NOW)
  })

  it('support_agent ЧУЖОГО тенанта → ForbiddenError (DTJ-282 межтенантная изоляция)', async () => {
    const { useCase } = buildHarness(ticket())
    await expect(
      useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1', 'tenant-2'), body: 'hi' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
