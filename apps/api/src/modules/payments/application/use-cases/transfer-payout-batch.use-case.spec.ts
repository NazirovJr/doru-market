/**
 * Unit-тесты `TransferPayoutBatchUseCase` (DTJ-250) — `BankPayoutTransferPort` замокан
 * (`vi.fn()`), доказывает: (1) пустой батч — короткое замыкание, порт НЕ вызывается (AC4);
 * (2) полный успех — все id проброшены как подтверждённые; (3) частичный сбой — только
 * `partialSuccess.confirmedPayoutScheduleIds` возвращаются подтверждёнными (Критерий 2);
 * (4) полный сбой без `partialSuccess` — НИЧЕГО не подтверждено, `batchRef=null`, use case НЕ
 * бросает (проверяет `resolves`, не `rejects`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { BankPayoutTransferPort, PayoutTransferItem } from '@/modules/payments/application/ports/bank-payout-transfer.port.js'
import { TransferPayoutBatchUseCase } from './transfer-payout-batch.use-case.js'

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

const ITEM_A: PayoutTransferItem = { payoutScheduleId: 'ps-a', pharmacyMerchantRef: 'merchant-a', amountDiram: 10_000n }
const ITEM_B: PayoutTransferItem = { payoutScheduleId: 'ps-b', pharmacyMerchantRef: 'merchant-b', amountDiram: 20_000n }
const ITEM_C: PayoutTransferItem = { payoutScheduleId: 'ps-c', pharmacyMerchantRef: 'merchant-c', amountDiram: 30_000n }

function makeUseCase(transferBatch: ReturnType<typeof vi.fn<BankPayoutTransferPort['transferBatch']>>): TransferPayoutBatchUseCase {
  const port: BankPayoutTransferPort = { transferBatch }
  return new TransferPayoutBatchUseCase(port, SILENT_LOGGER)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TransferPayoutBatchUseCase (DTJ-250)', () => {
  it('AC4: пустой батч — порт НЕ вызывается, возвращает batchRef=null/confirmed=[]', async () => {
    const transferBatch = vi.fn<BankPayoutTransferPort['transferBatch']>()
    const useCase = makeUseCase(transferBatch)

    const result = await useCase.execute({ payouts: [] })

    expect(transferBatch).not.toHaveBeenCalled()
    expect(result).toEqual({ batchRef: null, confirmedPayoutScheduleIds: [] })
  })

  it('Критерий 1: полный успех — ВСЕ id батча возвращены подтверждёнными с тем же batchRef', async () => {
    const transferBatch = vi.fn<BankPayoutTransferPort['transferBatch']>().mockResolvedValue({ ok: true, value: { batchRef: 'batch-1' } })
    const useCase = makeUseCase(transferBatch)

    const result = await useCase.execute({ payouts: [ITEM_A, ITEM_B, ITEM_C] })

    expect(transferBatch).toHaveBeenCalledExactlyOnceWith([ITEM_A, ITEM_B, ITEM_C])
    expect(result).toEqual({ batchRef: 'batch-1', confirmedPayoutScheduleIds: ['ps-a', 'ps-b', 'ps-c'] })
  })

  it('Критерий 2: частичный сбой (Err с partialSuccess) — только confirmedPayoutScheduleIds из partialSuccess возвращены, остальные НЕ включены', async () => {
    const transferBatch = vi.fn<BankPayoutTransferPort['transferBatch']>().mockResolvedValue({
      ok: false,
      error: {
        code: 'PARTIAL_TRANSFER_FAILURE',
        message: '1 of 3 unconfirmed',
        partialSuccess: { batchRef: 'batch-2', confirmedPayoutScheduleIds: ['ps-a', 'ps-c'] },
      },
    })
    const useCase = makeUseCase(transferBatch)

    const result = await useCase.execute({ payouts: [ITEM_A, ITEM_B, ITEM_C] })

    expect(result).toEqual({ batchRef: 'batch-2', confirmedPayoutScheduleIds: ['ps-a', 'ps-c'] })
  })

  it('полный сбой (Err без partialSuccess) — НИЧЕГО не подтверждено, batchRef=null, use case НЕ бросает', async () => {
    const transferBatch = vi
      .fn<BankPayoutTransferPort['transferBatch']>()
      .mockResolvedValue({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'bank down' } })
    const useCase = makeUseCase(transferBatch)

    await expect(useCase.execute({ payouts: [ITEM_A] })).resolves.toEqual({ batchRef: null, confirmedPayoutScheduleIds: [] })
  })
})
