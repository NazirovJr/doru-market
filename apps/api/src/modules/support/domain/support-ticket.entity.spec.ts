import { describe, expect, it } from 'vitest'
import { ValidationError, type SupportTicketChannel, type SupportTicketStatus } from '@dorutj/contracts'
import { fixedDate } from '@/shared-kernel/testing/fixtures/fixed-date.fixture.js'
import { SupportTicket, type SupportTicketOpenCommand, type SupportTicketSnapshot } from './support-ticket.entity.js'
import { SupportTicketMessage } from './support-ticket-message.entity.js'
import { SupportTicketCategory } from './value-objects/support-ticket-category.vo.js'
import { InvalidTicketStatusTransitionError } from './errors/invalid-ticket-status-transition.error.js'
import { TicketAlreadyTerminalError } from './errors/ticket-already-terminal.error.js'

const NOW = fixedDate('2026-06-01T00:00:00Z')
const SLA_MINUTES = 60

function baseCommand(overrides: Partial<SupportTicketOpenCommand> = {}): SupportTicketOpenCommand {
  return {
    id: 'ticket-1',
    tenantId: 'tenant-1',
    channel: 'in_app',
    category: SupportTicketCategory.fromTrusted('order_not_received'),
    createdBy: 'customer-1',
    firstResponseSlaMinutes: SLA_MINUTES,
    ...overrides,
  }
}

function buildSnapshot(status: SupportTicketStatus, overrides: Partial<SupportTicketSnapshot> = {}): SupportTicketSnapshot {
  return {
    id: 'ticket-1',
    tenantId: 'tenant-1',
    orderId: null,
    channel: 'in_app',
    category: SupportTicketCategory.fromTrusted('order_not_received'),
    status,
    priority: 0,
    createdBy: 'customer-1',
    description: null,
    firstResponseDueAt: NOW,
    firstRespondedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('SupportTicket.open()', () => {
  const channels: readonly SupportTicketChannel[] = ['in_app', 'telegram_bot', 'phone', 'system_auto']

  it.each(channels.filter((c) => c !== 'system_auto'))('канал "%s" требует createdBy', (channel) => {
    const ticket = SupportTicket.open(baseCommand({ channel, createdBy: 'customer-1' }), NOW)
    expect(ticket.channel).toBe(channel)
    expect(ticket.createdBy).toBe('customer-1')
  })

  it('channel=system_auto допускает отсутствующий createdBy (createdBy IS NULL)', () => {
    const { createdBy: _omit, ...rest } = baseCommand({ channel: 'system_auto' })
    const ticket = SupportTicket.open(rest, NOW)
    expect(ticket.createdBy).toBeNull()
  })

  it('channel=in_app, createdBy отсутствует — ValidationError (createdBy обязателен для не-системных каналов, критерий приёмки 4)', () => {
    const { createdBy: _omit, ...rest } = baseCommand({ channel: 'in_app' })
    expect(() => SupportTicket.open(rest, NOW)).toThrow(ValidationError)
  })

  it('status=open, priority=0 по умолчанию', () => {
    const ticket = SupportTicket.open(baseCommand(), NOW)
    expect(ticket.status).toBe('open')
    expect(ticket.priority).toBe(0)
  })

  it('firstResponseDueAt = openedAt + firstResponseSlaMinutes (не Date.now()/захардкоженное число)', () => {
    const ticket = SupportTicket.open(baseCommand({ firstResponseSlaMinutes: 45 }), NOW)
    expect(ticket.firstResponseDueAt?.getTime()).toBe(NOW.getTime() + 45 * 60_000)
  })

  it('isEscrowBlocking — ВСЕГДА false, конструктор не принимает и не может принять иное значение (критерий приёмки 1, гарантия структурная)', () => {
    const ticket = SupportTicket.open(baseCommand({ category: SupportTicketCategory.fromTrusted('order_item_damaged_or_expired') }), NOW)
    expect(ticket.isEscrowBlocking).toBe(false)
    // `baseCommand()` физически не имеет поля isEscrowBlocking — SupportTicketOpenCommand его не объявляет,
    // поэтому здесь нет ветки, которую можно было бы обойти передачей true (структурная гарантия, не рантайм-проверка).
  })
})

describe('SupportTicket.transitionTo() — полная таблица переходов', () => {
  it('open → in_progress → resolved → closed — полный «счастливый путь»', () => {
    const ticket = SupportTicket.restore(buildSnapshot('open'))
    ticket.transitionTo('in_progress', 'agent-1', NOW)
    expect(ticket.status).toBe('in_progress')
    ticket.transitionTo('resolved', 'agent-1', NOW)
    expect(ticket.status).toBe('resolved')
    ticket.transitionTo('closed', 'agent-1', NOW)
    expect(ticket.status).toBe('closed')
  })

  it('open → resolved напрямую — разрешено', () => {
    const ticket = SupportTicket.restore(buildSnapshot('open'))
    ticket.transitionTo('resolved', 'agent-1', NOW)
    expect(ticket.status).toBe('resolved')
  })

  it('resolved → in_progress — переоткрытие разрешено (первым же support_agent-комментарием, критерий приёмки 2)', () => {
    const ticket = SupportTicket.restore(buildSnapshot('resolved'))
    ticket.transitionTo('in_progress', 'agent-1', NOW)
    expect(ticket.status).toBe('in_progress')
  })

  it('closed — терминален: любая мутация бросает TicketAlreadyTerminalError (критерий приёмки 2)', () => {
    const ticket = SupportTicket.restore(buildSnapshot('closed'))
    expect(() => { ticket.transitionTo('in_progress', 'agent-1', NOW); }).toThrow(TicketAlreadyTerminalError)
    expect(() => { ticket.transitionTo('resolved', 'agent-1', NOW); }).toThrow(TicketAlreadyTerminalError)
  })

  const allStatuses: readonly SupportTicketStatus[] = ['open', 'in_progress', 'resolved', 'closed']
  const allTargets: readonly ('in_progress' | 'resolved' | 'closed')[] = ['in_progress', 'resolved', 'closed']
  const allowed: Readonly<Record<SupportTicketStatus, readonly string[]>> = {
    open: ['in_progress', 'resolved'],
    in_progress: ['resolved'],
    resolved: ['closed', 'in_progress'],
    closed: [],
  }

  for (const status of allStatuses) {
    for (const target of allTargets) {
      if (allowed[status].includes(target)) continue
      it(`${status} → ${target} — недопустимо, бросает ошибку`, () => {
        const ticket = SupportTicket.restore(buildSnapshot(status))
        if (status === 'closed') {
          expect(() => { ticket.transitionTo(target, 'agent-1', NOW); }).toThrow(TicketAlreadyTerminalError)
        } else {
          expect(() => { ticket.transitionTo(target, 'agent-1', NOW); }).toThrow(InvalidTicketStatusTransitionError)
        }
      })
    }
  }
})

describe('SupportTicket.recordFirstResponse() — идемпотентность', () => {
  it('повторный вызов с более поздним временем НЕ перезаписывает значение (критерий приёмки 3)', () => {
    const ticket = SupportTicket.restore(buildSnapshot('open'))
    const first = fixedDate('2026-06-01T10:00:00Z')
    const second = fixedDate('2026-06-01T12:00:00Z')
    ticket.recordFirstResponse(first)
    ticket.recordFirstResponse(second)
    expect(ticket.firstRespondedAt).toEqual(first)
  })
})

describe('SupportTicket.addMessage()', () => {
  it('сообщение от support_agent автоматически фиксирует firstRespondedAt, НЕ мутирует status', () => {
    const ticket = SupportTicket.restore(buildSnapshot('open'))
    const respondedAt = fixedDate('2026-06-01T09:00:00Z')
    const message = SupportTicketMessage.create(
      { id: 'msg-1', ticketId: ticket.id, authorUserId: 'agent-1', authorRole: 'support_agent', body: 'разбираемся' },
      respondedAt,
    )
    ticket.addMessage(message)
    expect(ticket.firstRespondedAt).toEqual(respondedAt)
    expect(ticket.status).toBe('open')
  })

  it('сообщение от customer НЕ фиксирует firstRespondedAt', () => {
    const ticket = SupportTicket.restore(buildSnapshot('open'))
    const message = SupportTicketMessage.create(
      { id: 'msg-1', ticketId: ticket.id, authorUserId: 'customer-1', authorRole: 'customer', body: 'привет' },
      NOW,
    )
    ticket.addMessage(message)
    expect(ticket.firstRespondedAt).toBeNull()
  })

  it('второе сообщение support_agent НЕ перезаписывает уже зафиксированное firstRespondedAt', () => {
    const ticket = SupportTicket.restore(buildSnapshot('open'))
    const firstAt = fixedDate('2026-06-01T09:00:00Z')
    const secondAt = fixedDate('2026-06-01T11:00:00Z')
    ticket.addMessage(
      SupportTicketMessage.create({ id: 'msg-1', ticketId: ticket.id, authorUserId: 'agent-1', authorRole: 'support_agent', body: 'a' }, firstAt),
    )
    ticket.addMessage(
      SupportTicketMessage.create({ id: 'msg-2', ticketId: ticket.id, authorUserId: 'agent-1', authorRole: 'support_agent', body: 'b' }, secondAt),
    )
    expect(ticket.firstRespondedAt).toEqual(firstAt)
  })
})

describe('SupportTicket.toSnapshot()/restore() — round-trip', () => {
  it('сохраняет все поля', () => {
    const original = SupportTicket.open(baseCommand(), NOW)
    const restored = SupportTicket.restore(original.toSnapshot())
    expect(restored.toSnapshot()).toEqual(original.toSnapshot())
  })
})
