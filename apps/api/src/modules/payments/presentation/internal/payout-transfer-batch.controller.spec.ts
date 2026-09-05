/**
 * `PayoutTransferBatchController` (DTJ-250) — тот же приём, что `system-cancel-order.controller.
 * spec.ts` (DTJ-253/254): гвард тестируется отдельно (`payments-internal-service.guard.spec.ts`),
 * здесь проверяем ТОЛЬКО делегирование и форму ответа.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  TransferPayoutBatchOutcome,
  TransferPayoutBatchUseCase,
} from '@/modules/payments/application/use-cases/transfer-payout-batch.use-case.js'
import { PayoutTransferBatchController } from './payout-transfer-batch.controller.js'

function fakeUseCase(execute: ReturnType<typeof vi.fn>): TransferPayoutBatchUseCase {
  return { execute } as unknown as TransferPayoutBatchUseCase
}

describe('PayoutTransferBatchController (DTJ-250)', () => {
  it('маппит payouts (body, amountDiram — строка на проводе) в команду use case как bigint', async () => {
    const outcome: TransferPayoutBatchOutcome = { batchRef: 'batch-1', confirmedPayoutScheduleIds: ['ps-a'] }
    const execute = vi.fn().mockResolvedValue(outcome)
    const controller = new PayoutTransferBatchController(fakeUseCase(execute))

    const response = await controller.transferBatch({
      payouts: [{ payoutScheduleId: 'ps-a', pharmacyMerchantRef: 'merchant-a', amountDiram: 12_345n }],
    })

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      payouts: [{ payoutScheduleId: 'ps-a', pharmacyMerchantRef: 'merchant-a', amountDiram: 12_345n }],
    })
    expect(response).toEqual({ data: outcome })
  })

  it('пробрасывает результат use case как есть (batchRef=null — ничего не подтверждено)', async () => {
    const outcome: TransferPayoutBatchOutcome = { batchRef: null, confirmedPayoutScheduleIds: [] }
    const execute = vi.fn().mockResolvedValue(outcome)
    const controller = new PayoutTransferBatchController(fakeUseCase(execute))

    const response = await controller.transferBatch({ payouts: [] })

    expect(response.data).toEqual(outcome)
  })
})
