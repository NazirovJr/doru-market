/**
 * Unit-тест `EscalateTicketPriorityUseCase` (EP-14, DTJ-280, тест-план тикета) — все порты
 * замоканы, `SupportTicket` — реальный домен через `restore()` (не мок), тот же приём, что
 * `create-support-ticket.use-case.spec.ts`. Фокус — критерии приёмки 1/2 тикета на уровне
 * оркестрации (единая транзакция save+append, `TicketNotFoundError` не вызывает ни одной мутации).
 * Анти-дребезг повторной эскалации (критерий приёмки 3) и изоляция сбоев батча (критерий приёмки
 * 4) — забота `support-sla-monitor.job.spec.ts` (воркер), не этого use case (см. его JSDoc).
 */
import { describe, expect, it, vi } from 'vitest'
import { SupportTicket, TicketNotFoundError } from '../../domain/index.js'
import { SupportTicketCategory } from '../../domain/value-objects/support-ticket-category.vo.js'
import type { SupportUnitOfWorkPort, SupportUnitOfWorkTx } from '../ports/support-unit-of-work.port.js'
import { EscalateTicketPriorityUseCase } from './escalate-ticket-priority.use-case.js'

const TX_MARKER: SupportUnitOfWorkTx = { marker: 'tx' }
const FIXED_NOW = new Date('2026-09-04T10:00:00.000Z')
const TICKET_ID = 'ticket-1'
const TENANT_ID = 'tenant-1'
const SLA_MINUTES = 60

function openTicket(overrides: { priority?: number; lastEscalatedAt?: Date | null } = {}): SupportTicket {
  return SupportTicket.restore({
    id: TICKET_ID,
    tenantId: TENANT_ID,
    orderId: null,
    channel: 'in_app',
    category: SupportTicketCategory.fromTrusted('order_not_received'),
    status: 'open',
    priority: overrides.priority ?? 0,
    createdBy: 'customer-1',
    description: null,
    firstResponseDueAt: new Date('2026-09-04T09:00:00.000Z'),
    firstRespondedAt: null,
    lastEscalatedAt: overrides.lastEscalatedAt ?? null,
    createdAt: new Date('2026-09-04T08:00:00.000Z'),
    updatedAt: new Date('2026-09-04T08:00:00.000Z'),
  })
}

function buildHarness(ticket: SupportTicket | null) {
  const callOrder: string[] = []
  const findByIdMock = vi.fn().mockResolvedValue(ticket)
  const saveMock = vi.fn((_ticket: SupportTicket, _tx: SupportUnitOfWorkTx) => {
    callOrder.push('save')
    return Promise.resolve()
  })
  const getFirstResponseSlaMinutesMock = vi.fn().mockResolvedValue(SLA_MINUTES)
  const appendMock = vi.fn((_tenantId: string, _event: unknown, _tx: SupportUnitOfWorkTx) => {
    callOrder.push('append')
    return Promise.resolve()
  })
  const nowMock = vi.fn(() => FIXED_NOW)

  const repository = { findById: findByIdMock, save: saveMock }
  const tenantSettings = { getFirstResponseSlaMinutes: getFirstResponseSlaMinutesMock }
  const outbox = { append: appendMock }
  const unitOfWork: SupportUnitOfWorkPort = { run: (cb) => cb(TX_MARKER) }
  const clock = { now: nowMock }

  const useCase = new EscalateTicketPriorityUseCase(repository, tenantSettings, unitOfWork, outbox, clock)
  return { useCase, findByIdMock, saveMock, getFirstResponseSlaMinutesMock, appendMock, callOrder }
}

describe('EscalateTicketPriorityUseCase', () => {
  it('критерий приёмки 1 — priority увеличен на 1, SlaBreachedEvent опубликован ровно один раз, save+append на ОДНОМ tx', async () => {
    const h = buildHarness(openTicket({ priority: 0 }))

    const result = await h.useCase.execute({ ticketId: TICKET_ID })

    expect(result).toEqual({ ticketId: TICKET_ID, priority: 1 })
    expect(h.callOrder).toEqual(['save', 'append'])
    expect(h.saveMock).toHaveBeenCalledTimes(1)
    expect(h.appendMock).toHaveBeenCalledTimes(1)
    const [savedTicket, saveTx] = h.saveMock.mock.calls[0] as [SupportTicket, SupportUnitOfWorkTx]
    expect(savedTicket.priority).toBe(1)
    expect(savedTicket.lastEscalatedAt).toEqual(FIXED_NOW)
    expect(saveTx).toBe(TX_MARKER)
    expect(h.appendMock).toHaveBeenCalledWith(
      TENANT_ID,
      {
        type: 'SlaBreachedEvent',
        entityType: 'support_ticket',
        entityId: TICKET_ID,
        tenantId: TENANT_ID,
        breachedAt: FIXED_NOW,
        slaMinutes: SLA_MINUTES,
      },
      TX_MARKER,
    )
  })

  it('уже эскалированный ранее тикет — повторный вызов use case ВСЕГДА эскалирует ещё раз (безусловная команда, анти-дребезг — забота вызывающего скана, не этого use case)', async () => {
    const h = buildHarness(openTicket({ priority: 1, lastEscalatedAt: new Date('2026-09-04T09:50:00.000Z') }))

    const result = await h.useCase.execute({ ticketId: TICKET_ID })

    expect(result).toEqual({ ticketId: TICKET_ID, priority: 2 })
  })

  it('тикет не найден — TicketNotFoundError, save()/append() НИКОГДА не вызваны', async () => {
    const h = buildHarness(null)

    await expect(h.useCase.execute({ ticketId: TICKET_ID })).rejects.toBeInstanceOf(TicketNotFoundError)

    expect(h.saveMock).not.toHaveBeenCalled()
    expect(h.appendMock).not.toHaveBeenCalled()
  })
})
