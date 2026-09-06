/**
 * Unit-тест `sla-status.ts` (DTJ-283, тест-план: «SlaBadge — все 3 цветовых состояния по входным
 * firstResponseDueAt/firstRespondedAt, unit-тест чистой функции, отдельно от рендера»).
 */
import { describe, expect, it } from 'vitest'
import type { SupportTicketDto } from '@dorutj/contracts'
import { compareByUrgency, computeSlaState, isOverdue } from './sla-status'

const NOW = new Date('2026-09-06T12:00:00.000Z')
const MINUTES = 60_000

function ticket(overrides: Partial<SupportTicketDto> = {}): SupportTicketDto {
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
    description: null,
    firstResponseDueAt: new Date(NOW.getTime() + 60 * MINUTES).toISOString(),
    firstRespondedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    messages: [],
    ...overrides,
  }
}

describe('computeSlaState', () => {
  it('firstRespondedAt задан → responded (независимо от дедлайна)', () => {
    expect(computeSlaState(ticket({ firstRespondedAt: NOW.toISOString() }), NOW)).toBe('responded')
  })

  it('дедлайн уже прошёл, firstRespondedAt=null → overdue', () => {
    const dueInThePast = new Date(NOW.getTime() - 5 * MINUTES).toISOString()
    expect(computeSlaState(ticket({ firstResponseDueAt: dueInThePast }), NOW)).toBe('overdue')
  })

  it('дедлайн ровно сейчас (0мс) → overdue (граница включительно)', () => {
    expect(computeSlaState(ticket({ firstResponseDueAt: NOW.toISOString() }), NOW)).toBe('overdue')
  })

  it('дедлайн через 10 минут (< 15) → warning', () => {
    const dueSoon = new Date(NOW.getTime() + 10 * MINUTES).toISOString()
    expect(computeSlaState(ticket({ firstResponseDueAt: dueSoon }), NOW)).toBe('warning')
  })

  it('дедлайн через 60 минут (> 15) → ok', () => {
    const dueLater = new Date(NOW.getTime() + 60 * MINUTES).toISOString()
    expect(computeSlaState(ticket({ firstResponseDueAt: dueLater }), NOW)).toBe('ok')
  })

  it('firstResponseDueAt=null (тенант без настроенного SLA) → ok, не ложная тревога', () => {
    expect(computeSlaState(ticket({ firstResponseDueAt: null }), NOW)).toBe('ok')
  })
})

describe('isOverdue', () => {
  it('true только для состояния overdue', () => {
    expect(isOverdue(ticket({ firstResponseDueAt: new Date(NOW.getTime() - MINUTES).toISOString() }), NOW)).toBe(true)
    expect(isOverdue(ticket({ firstResponseDueAt: new Date(NOW.getTime() + 60 * MINUTES).toISOString() }), NOW)).toBe(false)
    expect(isOverdue(ticket({ firstRespondedAt: NOW.toISOString() }), NOW)).toBe(false)
  })
})

describe('compareByUrgency', () => {
  it('АС1 — просроченный тикет сортируется ПЕРВЫМ перед тикетами в пределах SLA', () => {
    const overdueTicket = ticket({ id: 'overdue', firstResponseDueAt: new Date(NOW.getTime() - MINUTES).toISOString() })
    const okTicketA = ticket({ id: 'ok-a', firstResponseDueAt: new Date(NOW.getTime() + 60 * MINUTES).toISOString() })
    const okTicketB = ticket({ id: 'ok-b', firstResponseDueAt: new Date(NOW.getTime() + 90 * MINUTES).toISOString() })

    const sorted = [okTicketA, overdueTicket, okTicketB].sort((a, b) => compareByUrgency(a, b, NOW))

    expect(sorted[0]?.id).toBe('overdue')
  })

  it('внутри одного SLA-состояния — по убыванию priority', () => {
    const lowPriority = ticket({ id: 'low', priority: 0, firstResponseDueAt: new Date(NOW.getTime() - MINUTES).toISOString() })
    const highPriority = ticket({ id: 'high', priority: 2, firstResponseDueAt: new Date(NOW.getTime() - MINUTES).toISOString() })

    const sorted = [lowPriority, highPriority].sort((a, b) => compareByUrgency(a, b, NOW))

    expect(sorted[0]?.id).toBe('high')
  })
})
