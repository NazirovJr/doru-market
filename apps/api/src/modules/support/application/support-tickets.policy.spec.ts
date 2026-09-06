/**
 * Unit-тест `SupportTicketsPolicy` (EP-14, DTJ-281, тест-план тикета: «все комбинации
 * роль×владение для canRead/canRespond/canResolve»).
 */
import { describe, expect, it } from 'vitest'
import { SupportTicket } from '../domain/index.js'
import { SupportTicketCategory } from '../domain/value-objects/support-ticket-category.vo.js'
import { SupportTicketsPolicy, type SupportTicketsPolicyActor } from './support-tickets.policy.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const OWNER_ID = 'customer-1'
const OTHER_CUSTOMER_ID = 'customer-2'

function ownedTicket(): SupportTicket {
  return SupportTicket.restore({
    id: 'ticket-1',
    tenantId: 'tenant-1',
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

function actor(role: SupportTicketsPolicyActor['role'], userId: string): SupportTicketsPolicyActor {
  return { role, userId }
}

describe('SupportTicketsPolicy', () => {
  describe('canRead', () => {
    it('владелец тикета → true', () => {
      expect(SupportTicketsPolicy.canRead(actor('customer', OWNER_ID), ownedTicket())).toBe(true)
    })

    it('другой customer (не владелец) → false', () => {
      expect(SupportTicketsPolicy.canRead(actor('customer', OTHER_CUSTOMER_ID), ownedTicket())).toBe(false)
    })

    it('support_agent (не владелец) → true', () => {
      expect(SupportTicketsPolicy.canRead(actor('support_agent', 'agent-1'), ownedTicket())).toBe(true)
    })

    it('super_admin (не владелец) → true', () => {
      expect(SupportTicketsPolicy.canRead(actor('super_admin', 'admin-1'), ownedTicket())).toBe(true)
    })

    it('pharmacist/courier/pharmacy_admin (не владелец, не staff поддержки) → false', () => {
      expect(SupportTicketsPolicy.canRead(actor('pharmacist', 'pharm-1'), ownedTicket())).toBe(false)
      expect(SupportTicketsPolicy.canRead(actor('courier', 'courier-1'), ownedTicket())).toBe(false)
      expect(SupportTicketsPolicy.canRead(actor('pharmacy_admin', 'padmin-1'), ownedTicket())).toBe(false)
    })
  })

  describe('canRespond', () => {
    it('support_agent/super_admin → true', () => {
      expect(SupportTicketsPolicy.canRespond(actor('support_agent', 'agent-1'))).toBe(true)
      expect(SupportTicketsPolicy.canRespond(actor('super_admin', 'admin-1'))).toBe(true)
    })

    it('владелец тикета (customer) сам по себе → false (владелец допускается отдельной веткой контроллера, не этим методом)', () => {
      expect(SupportTicketsPolicy.canRespond(actor('customer', OWNER_ID))).toBe(false)
    })

    it('прочие роли → false', () => {
      expect(SupportTicketsPolicy.canRespond(actor('pharmacist', 'pharm-1'))).toBe(false)
      expect(SupportTicketsPolicy.canRespond(actor('courier', 'courier-1'))).toBe(false)
    })
  })

  describe('canResolve', () => {
    it('support_agent/super_admin → true', () => {
      expect(SupportTicketsPolicy.canResolve(actor('support_agent', 'agent-1'))).toBe(true)
      expect(SupportTicketsPolicy.canResolve(actor('super_admin', 'admin-1'))).toBe(true)
    })

    it('владелец тикета → false (резолюция — исключительно сотрудник поддержки)', () => {
      expect(SupportTicketsPolicy.canResolve(actor('customer', OWNER_ID))).toBe(false)
    })
  })
})
