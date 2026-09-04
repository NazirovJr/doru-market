/**
 * Unit-тесты `MockBankPayoutTransferProvider` (DTJ-250) — happy path (ticket «Тест-план»), плюс
 * частичный/полный отказ на уровне САМОГО мока (глубже, чем формально требует тест-план, но
 * дёшево и напрямую страхует Критерий 2 DTJ-250 на источнике поведения).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { isErr, isOk } from '@dorutj/domain-kernel'
import type { AppConfigService } from '@/config/app-config.service.js'
import { MOCK_PAYOUT_FORCE_UNCONFIRMED_REF, MockBankPayoutTransferProvider } from './mock-bank-payout-transfer.provider.js'
import type { PayoutTransferItem } from '@/modules/payments/application/ports/bank-payout-transfer.port.js'

function fakeConfig(mockPayoutDelayMs = 0): AppConfigService {
  return { mockPayoutDelayMs } as unknown as AppConfigService
}

const ITEM_A: PayoutTransferItem = { payoutScheduleId: 'ps-a', pharmacyMerchantRef: 'merchant-a', amountDiram: 10_000n }
const ITEM_B: PayoutTransferItem = { payoutScheduleId: 'ps-b', pharmacyMerchantRef: 'merchant-b', amountDiram: 20_000n }
const ITEM_C: PayoutTransferItem = { payoutScheduleId: 'ps-c', pharmacyMerchantRef: 'merchant-c', amountDiram: 30_000n }

describe('MockBankPayoutTransferProvider (DTJ-250)', () => {
  let provider: MockBankPayoutTransferProvider

  beforeEach(() => {
    provider = new MockBankPayoutTransferProvider(fakeConfig())
  })

  it('happy path: все строки батча подтверждены, batchRef с префиксом mock_batch_', async () => {
    const result = await provider.transferBatch([ITEM_A, ITEM_B, ITEM_C])

    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.value.batchRef).toMatch(/^mock_batch_/)
    }
  })

  it('пустой батч — тоже успешно подтверждён (адаптер не отвечает за короткое замыкание — это забота вызывающего кода, AC4)', async () => {
    const result = await provider.transferBatch([])

    expect(isOk(result)).toBe(true)
  })

  it('частичный сбой: 1 из 3 строк помечена MOCK_PAYOUT_FORCE_UNCONFIRMED_REF → Err с partialSuccess, содержащим ровно 2 confirmed id', async () => {
    const forcedFail: PayoutTransferItem = { ...ITEM_B, pharmacyMerchantRef: MOCK_PAYOUT_FORCE_UNCONFIRMED_REF }

    const result = await provider.transferBatch([ITEM_A, forcedFail, ITEM_C])

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error.partialSuccess?.confirmedPayoutScheduleIds).toEqual(['ps-a', 'ps-c'])
      expect(result.error.partialSuccess?.batchRef).toMatch(/^mock_batch_/)
    }
  })

  it('полный сбой: ВСЕ строки помечены MOCK_PAYOUT_FORCE_UNCONFIRMED_REF → Err БЕЗ partialSuccess (не частичный успех)', async () => {
    const allForced: PayoutTransferItem = { ...ITEM_A, pharmacyMerchantRef: MOCK_PAYOUT_FORCE_UNCONFIRMED_REF }

    const result = await provider.transferBatch([allForced])

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error.partialSuccess).toBeUndefined()
    }
  })

  it('MOCK_PAYOUT_DELAY_MS > 0 — задержка соблюдается перед подтверждением (AC-подобно MockBankProvider DTJ-238)', async () => {
    const delayedProvider = new MockBankPayoutTransferProvider(fakeConfig(20))
    const start = Date.now()

    await delayedProvider.transferBatch([ITEM_A])

    expect(Date.now() - start).toBeGreaterThanOrEqual(15) // допуск на таймер-джиттер
  })
})
