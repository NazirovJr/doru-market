/**
 * Unit-тест `ChangeSupportTicketStatusUseCase` (EP-14, DTJ-282, тест-план тикета: «маппинг
 * ошибок — TicketAlreadyTerminalError → 409, InvalidTicketStatusTransitionError → 409» — здесь
 * проверяется, что use case их НЕ перехватывает, они пропагируют как есть).
 */
import { ForbiddenError } from '@dorutj/contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  InvalidTicketStatusTransitionError,
  SupportTicket,
  TicketAlreadyTerminalError,
  TicketNotFoundError,
} from '../../domain/index.js'
import { SupportTicketCategory } from '../../domain/value-objects/support-ticket-category.vo.js'
import type { SupportTicketsRepositoryPort } from '../ports/support-tickets-repository.port.js'
import type { SupportTicketsPolicyActor } from '../support-tickets.policy.js'
import { ChangeSupportTicketStatusUseCase } from './change-support-ticket-status.use-case.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const TENANT_ID = 'tenant-1'

function ticket(status: 'open' | 'in_progress' | 'resolved' | 'closed' = 'open'): SupportTicket {
  return SupportTicket.restore({
    id: 'ticket-1',
    tenantId: TENANT_ID,
    orderId: null,
    channel: 'in_app',
    category: SupportTicketCategory.fromTrusted('other'),
    status,
    priority: 0,
    createdBy: 'customer-1',
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
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const repository: SupportTicketsRepositoryPort = {
    save: saveMock,
    findById: vi.fn().mockResolvedValue(foundTicket),
    list: vi.fn(),
    saveMessage: vi.fn(),
    listMessagesByTicketId: vi.fn(),
  }
  const clock = { now: () => NOW }
  return { useCase: new ChangeSupportTicketStatusUseCase(repository, clock), saveMock }
}

describe('ChangeSupportTicketStatusUseCase', () => {
  it('тикет не найден → TicketNotFoundError', async () => {
    const { useCase } = buildHarness(null)
    await expect(
      useCase.execute({ ticketId: 'missing', actor: actor('support_agent', 'agent-1'), status: 'in_progress' }),
    ).rejects.toBeInstanceOf(TicketNotFoundError)
  })

  it('customer (не staff) → ForbiddenError, save НЕ вызван', async () => {
    const { useCase, saveMock } = buildHarness(ticket('open'))
    await expect(
      useCase.execute({ ticketId: 'ticket-1', actor: actor('customer', 'customer-1'), status: 'in_progress' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('support_agent ЧУЖОГО тенанта → ForbiddenError (DTJ-282 межтенантная изоляция)', async () => {
    const { useCase } = buildHarness(ticket('open'))
    await expect(
      useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1', 'tenant-2'), status: 'in_progress' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('support_agent СВОЕГО тенанта, валидный переход open→in_progress → сохранено', async () => {
    const { useCase, saveMock } = buildHarness(ticket('open'))
    const result = await useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1'), status: 'in_progress' })
    expect(result.status).toBe('in_progress')
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it('AC4 — тикет уже closed → TicketAlreadyTerminalError (409), НЕ перехвачена use case (пропагирует до AllExceptionsFilter)', async () => {
    const { useCase, saveMock } = buildHarness(ticket('closed'))
    await expect(
      useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1'), status: 'in_progress' }),
    ).rejects.toBeInstanceOf(TicketAlreadyTerminalError)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('переход, не входящий в ALLOWED_TRANSITIONS (in_progress→in_progress) → InvalidTicketStatusTransitionError', async () => {
    const { useCase } = buildHarness(ticket('in_progress'))
    await expect(
      useCase.execute({ ticketId: 'ticket-1', actor: actor('support_agent', 'agent-1'), status: 'in_progress' }),
    ).rejects.toBeInstanceOf(InvalidTicketStatusTransitionError)
  })
})
