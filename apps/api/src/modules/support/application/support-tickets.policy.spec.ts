/**
 * Unit-тест `SupportTicketsPolicy` (EP-14, DTJ-281/282, тест-план тикета: «все комбинации
 * роль×владение для canRead/canRespond/canResolve», расширено DTJ-282 тенант-изоляцией —
 * см. JSDoc политики про `actor.tenantId`).
 */
import { describe, expect, it } from 'vitest'
import { SupportTicket } from '../domain/index.js'
import { SupportTicketCategory } from '../domain/value-objects/support-ticket-category.vo.js'
import { SupportTicketsPolicy, type SupportTicketsPolicyActor } from './support-tickets.policy.js'

const NOW = new Date('2026-09-04T10:00:00.000Z')
const OWNER_ID = 'customer-1'
const OTHER_CUSTOMER_ID = 'customer-2'
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'

function ownedTicket(): SupportTicket {
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

describe('SupportTicketsPolicy', () => {
  describe('canRead', () => {
    it('владелец тикета (свой тенант) → true', () => {
      expect(SupportTicketsPolicy.canRead(actor('customer', OWNER_ID), ownedTicket())).toBe(true)
    })

    it('другой customer (не владелец) → false', () => {
      expect(SupportTicketsPolicy.canRead(actor('customer', OTHER_CUSTOMER_ID), ownedTicket())).toBe(false)
    })

    it('support_agent (не владелец, свой тенант) → true', () => {
      expect(SupportTicketsPolicy.canRead(actor('support_agent', 'agent-1'), ownedTicket())).toBe(true)
    })

    it('super_admin (не владелец, свой тенант) → true', () => {
      expect(SupportTicketsPolicy.canRead(actor('super_admin', 'admin-1'), ownedTicket())).toBe(true)
    })

    it('pharmacist/courier/pharmacy_admin (не владелец, не staff поддержки) → false', () => {
      expect(SupportTicketsPolicy.canRead(actor('pharmacist', 'pharm-1'), ownedTicket())).toBe(false)
      expect(SupportTicketsPolicy.canRead(actor('courier', 'courier-1'), ownedTicket())).toBe(false)
      expect(SupportTicketsPolicy.canRead(actor('pharmacy_admin', 'padmin-1'), ownedTicket())).toBe(false)
    })

    it('DTJ-282 — support_agent/super_admin ЧУЖОГО тенанта → false (межтенантная изоляция)', () => {
      expect(SupportTicketsPolicy.canRead(actor('support_agent', 'agent-1', OTHER_TENANT_ID), ownedTicket())).toBe(false)
      expect(SupportTicketsPolicy.canRead(actor('super_admin', 'admin-1', OTHER_TENANT_ID), ownedTicket())).toBe(false)
    })
  })

  describe('canRespond', () => {
    it('support_agent/super_admin (свой тенант) → true', () => {
      expect(SupportTicketsPolicy.canRespond(actor('support_agent', 'agent-1'), ownedTicket())).toBe(true)
      expect(SupportTicketsPolicy.canRespond(actor('super_admin', 'admin-1'), ownedTicket())).toBe(true)
    })

    it('владелец тикета (customer) сам по себе → false (владелец допускается отдельной веткой контроллера, не этим методом)', () => {
      expect(SupportTicketsPolicy.canRespond(actor('customer', OWNER_ID), ownedTicket())).toBe(false)
    })

    it('прочие роли → false', () => {
      expect(SupportTicketsPolicy.canRespond(actor('pharmacist', 'pharm-1'), ownedTicket())).toBe(false)
      expect(SupportTicketsPolicy.canRespond(actor('courier', 'courier-1'), ownedTicket())).toBe(false)
    })

    it('DTJ-282 — support_agent ЧУЖОГО тенанта → false (межтенантная изоляция)', () => {
      expect(SupportTicketsPolicy.canRespond(actor('support_agent', 'agent-1', OTHER_TENANT_ID), ownedTicket())).toBe(false)
    })
  })

  describe('canResolve', () => {
    it('support_agent/super_admin (свой тенант) → true', () => {
      expect(SupportTicketsPolicy.canResolve(actor('support_agent', 'agent-1'), ownedTicket())).toBe(true)
      expect(SupportTicketsPolicy.canResolve(actor('super_admin', 'admin-1'), ownedTicket())).toBe(true)
    })

    it('владелец тикета → false (резолюция — исключительно сотрудник поддержки)', () => {
      expect(SupportTicketsPolicy.canResolve(actor('customer', OWNER_ID), ownedTicket())).toBe(false)
    })

    it('DTJ-282 — support_agent ЧУЖОГО тенанта → false (межтенантная изоляция)', () => {
      expect(SupportTicketsPolicy.canResolve(actor('support_agent', 'agent-1', OTHER_TENANT_ID), ownedTicket())).toBe(false)
    })
  })

  describe('canListAll (DTJ-282)', () => {
    it('support_agent/super_admin → true (видят все тикеты тенанта)', () => {
      expect(SupportTicketsPolicy.canListAll(actor('support_agent', 'agent-1'))).toBe(true)
      expect(SupportTicketsPolicy.canListAll(actor('super_admin', 'admin-1'))).toBe(true)
    })

    it('прочие роли → false (только свои тикеты)', () => {
      expect(SupportTicketsPolicy.canListAll(actor('customer', OWNER_ID))).toBe(false)
      expect(SupportTicketsPolicy.canListAll(actor('pharmacist', 'pharm-1'))).toBe(false)
      expect(SupportTicketsPolicy.canListAll(actor('courier', 'courier-1'))).toBe(false)
      expect(SupportTicketsPolicy.canListAll(actor('pharmacy_admin', 'padmin-1'))).toBe(false)
    })
  })
})
