import { describe, expect, it } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import { fixedDate } from '@/shared-kernel/testing/fixtures/fixed-date.fixture.js'
import { SupportTicketMessage } from './support-ticket-message.entity.js'

const NOW = fixedDate('2026-06-01T00:00:00Z')

describe('SupportTicketMessage.create()', () => {
  it('создаёт сообщение с заданными полями', () => {
    const message = SupportTicketMessage.create(
      { id: 'msg-1', ticketId: 'ticket-1', authorUserId: 'user-1', authorRole: 'customer', body: 'где мой заказ?' },
      NOW,
    )
    expect(message.id).toBe('msg-1')
    expect(message.ticketId).toBe('ticket-1')
    expect(message.authorRole).toBe('customer')
    expect(message.body).toBe('где мой заказ?')
    expect(message.createdAt).toEqual(NOW)
  })

  it('пустое body — ValidationError', () => {
    expect(() =>
      SupportTicketMessage.create({ id: 'msg-1', ticketId: 'ticket-1', authorUserId: null, authorRole: 'support_agent', body: '   ' }, NOW),
    ).toThrow(ValidationError)
  })

  it('authorUserId=null допустим (system_auto/системное сообщение)', () => {
    const message = SupportTicketMessage.create(
      { id: 'msg-2', ticketId: 'ticket-1', authorUserId: null, authorRole: 'support_agent', body: 'авто-уведомление' },
      NOW,
    )
    expect(message.authorUserId).toBeNull()
  })
})

describe('SupportTicketMessage.toSnapshot()/restore()', () => {
  it('round-trip сохраняет все поля', () => {
    const original = SupportTicketMessage.create(
      { id: 'msg-1', ticketId: 'ticket-1', authorUserId: 'user-1', authorRole: 'customer', body: 'x' },
      NOW,
    )
    const restored = SupportTicketMessage.restore(original.toSnapshot())
    expect(restored.toSnapshot()).toEqual(original.toSnapshot())
  })
})
