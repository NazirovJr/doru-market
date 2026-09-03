/**
 * `ResolveBillingStrategyService` (EP-09, DTJ-228, AC3, D-EP09-33). R1 резолвит ИСКЛЮЧИТЕЛЬНО
 * `single_invoice` для ЛЮБОЙ комбинации `paymentMethod` (`split_items_delivery` физически
 * недостижима — оба поля, от которых она зависит, отсутствуют в схеме, TODO(DTJ-242/244), см.
 * JSDoc сервиса) — тест-план DTJ-228 «4 комбинации paymentMethod × useSplitBilling» сводится к
 * этому, поскольку `useSplitBilling` не читается сервисом вовсе в этой волне.
 */
import { describe, expect, it } from 'vitest'
import type { OrderPaymentMethod } from '@dorutj/contracts'
import { ResolveBillingStrategyService } from './resolve-billing-strategy.service.js'

describe('ResolveBillingStrategyService (DTJ-228, D-EP09-33)', () => {
  const service = new ResolveBillingStrategyService()

  it.each<OrderPaymentMethod>(['cash_courier', 'alif_mobi', 'dc_next'])(
    'paymentMethod=%s → всегда single_invoice (R1, useSplitBilling недостижим)',
    (paymentMethod) => {
      expect(service.resolve('tenant-1', paymentMethod)).toBe('single_invoice')
    },
  )

  it('AC3 — cash_courier → single_invoice независимо от tenantId', () => {
    expect(service.resolve('tenant-a', 'cash_courier')).toBe('single_invoice')
    expect(service.resolve('tenant-b', 'cash_courier')).toBe('single_invoice')
  })
})
