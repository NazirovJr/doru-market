import { describe, expect, it } from 'vitest'
import { ORDER_CANCEL_REASON_VALUES } from './order-domain-event.js'

describe('ORDER_CANCEL_REASON_VALUES (SRS-ORD-030)', () => {
  it('содержит канонический набор причин отмены, а не свободную строку', () => {
    expect(ORDER_CANCEL_REASON_VALUES).toEqual([
      'customer_changed_mind',
      'found_cheaper_elsewhere',
      'pharmacy_suspended',
      'payment_timeout',
      'pickup_sla_timeout',
      'fraud_or_safety_force_cancel',
      'license_revoked_force_cancel',
      'late_payment_after_cancellation',
    ])
  })
})
