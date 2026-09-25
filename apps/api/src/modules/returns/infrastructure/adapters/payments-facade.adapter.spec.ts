/** `PaymentsFacadeAdapter` — unit, маппинг команд порта. `PaymentsFacade` замокан. */
import { describe, expect, it, vi } from 'vitest'
import type { PaymentsFacade } from '@/modules/payments/index.js'
import { PaymentsFacadeAdapter } from './payments-facade.adapter.js'

const TENANT_ID = 'tenant-1'

function buildHarness() {
  const refundFull = vi.fn<PaymentsFacade['refundFull']>().mockResolvedValue(undefined)
  const recordAdjustment = vi.fn<PaymentsFacade['recordAdjustment']>().mockResolvedValue(undefined)
  const holdPayout = vi.fn<PaymentsFacade['holdPayout']>()
  const paymentsFacade: PaymentsFacade = { holdPayout, refundFull, recordAdjustment }
  const adapter = new PaymentsFacadeAdapter(paymentsFacade)
  return { adapter, refundFull, recordAdjustment, holdPayout }
}

describe('PaymentsFacadeAdapter (DTJ-285)', () => {
  it('refundFull — маппит returnId в reason аудита escrow_ledger, делегирует в PaymentsFacade.refundFull', async () => {
    const h = buildHarness()

    await h.adapter.refundFull(TENANT_ID, { orderId: 'order-1', returnId: 'return-1', amountDiram: 5_000n })

    expect(h.refundFull).toHaveBeenCalledExactlyOnceWith(TENANT_ID, { orderId: 'order-1', reason: 'return_confirmed:return-1' })
  })

  it('recordAdjustment — маппит orderId/amountDiram/reason/actorUserId 1:1, делегирует в PaymentsFacade.recordAdjustment', async () => {
    const h = buildHarness()

    await h.adapter.recordAdjustment(TENANT_ID, {
      orderId: 'order-1',
      returnId: 'return-1',
      amountDiram: 1_000n,
      reason: 'single_invoice full refund included a non-refundable delivery fee (SRS-RET-008)',
      actorUserId: '00000000-0000-0000-0000-000000000000',
    })

    expect(h.recordAdjustment).toHaveBeenCalledExactlyOnceWith({
      orderId: 'order-1',
      amountDiram: 1_000n,
      reason: 'single_invoice full refund included a non-refundable delivery fee (SRS-RET-008)',
      actorUserId: '00000000-0000-0000-0000-000000000000',
    })
  })

  it('refundItems — split_items_delivery структурно недостижим в R1 (D-EP09-33) — бросает, PaymentsFacade НЕ вызван', async () => {
    const h = buildHarness()

    await expect(h.adapter.refundItems(TENANT_ID, { orderId: 'order-1', returnId: 'return-1', amountDiram: 5_000n })).rejects.toThrow(
      /split_items_delivery/,
    )
    expect(h.refundFull).not.toHaveBeenCalled()
    expect(h.recordAdjustment).not.toHaveBeenCalled()
  })

  it('refundDelivery — тот же вывод, что refundItems — бросает, PaymentsFacade НЕ вызван', async () => {
    const h = buildHarness()

    await expect(h.adapter.refundDelivery(TENANT_ID, { orderId: 'order-1', returnId: 'return-1', amountDiram: 1_000n })).rejects.toThrow(
      /split_items_delivery/,
    )
    expect(h.refundFull).not.toHaveBeenCalled()
    expect(h.recordAdjustment).not.toHaveBeenCalled()
  })
})
