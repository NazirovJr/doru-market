import { describe, expect, it } from 'vitest'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { SUPPORT_TICKET_CATEGORY_VALUES } from '@dorutj/contracts'
import { SupportTicketCategory } from './support-ticket-category.vo.js'

const ESCROW_BLOCKING_ELIGIBLE = new Set([
  'order_not_received',
  'payment_issue',
  'order_item_damaged_or_expired',
  'order_quality_defect',
])

describe('SupportTicketCategory', () => {
  it.each(SUPPORT_TICKET_CATEGORY_VALUES)('parse() принимает валидное значение "%s"', (value) => {
    const result = SupportTicketCategory.parse(value)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.value.value).toBe(value)
    }
  })

  it('parse() отклоняет невалидную строку без исключения (Result, не throw)', () => {
    const result = SupportTicketCategory.parse('not_a_real_category')
    expect(isErr(result)).toBe(true)
  })

  it.each(SUPPORT_TICKET_CATEGORY_VALUES)('isEscrowBlockingEligible() для "%s" совпадает с таблицей SRS-DISP-001', (value) => {
    const category = SupportTicketCategory.fromTrusted(value)
    expect(category.isEscrowBlockingEligible()).toBe(ESCROW_BLOCKING_ELIGIBLE.has(value))
  })

  it('equals() сравнивает по значению', () => {
    const a = SupportTicketCategory.fromTrusted('payment_issue')
    const b = SupportTicketCategory.fromTrusted('payment_issue')
    const c = SupportTicketCategory.fromTrusted('other')
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })
})
