/**
 * `MockBankPayoutTransferProvider` (EP-10, DTJ-250, `21-module-orders-payments-escrow.md` §6.3,
 * SRS-PAY-033) — реализация `BankPayoutTransferPort` (DTJ-250). Единственный R1-адаптер: немедленно
 * (или с задержкой `MOCK_PAYOUT_DELAY_MS`, ASSUMPTION 0 — тикет) переводит ВСЕ переданные строки
 * батча в подтверждённые, `batchRef = 'mock_batch_' + uuid()`. Без сети наружу — тот же принцип,
 * что `MockBankProvider` (DTJ-238): единственный провайдер, реально работающий в R1-проде без
 * внешнего API-ключа.
 *
 * СИМУЛЯЦИЯ ЧАСТИЧНОГО СБОЯ ДЛЯ ТЕСТОВ (Критерий 2 DTJ-250, «тестовый мок» — тикет буквально
 * называет это ожидаемым свойством мока, не изъяном дизайна): `pharmacyMerchantRef ===
 * MOCK_PAYOUT_FORCE_UNCONFIRMED_REF` помечает ОДНУ конкретную строку батча как неподтверждённую —
 * НЕ отдельный тестовый конструктор/DI-параметр (усложнил бы прод-сигнатуру ради теста), а
 * значение, проходящее через ТОТ ЖЕ публичный `transferBatch()`, которым реально пользуется
 * `PayoutExecutionJob` — интеграционный тест этим не подменяет мок, а управляет им штатно.
 */
import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Result } from '@dorutj/domain-kernel'
import { AppConfigService } from '@/config/app-config.service.js'
import {
  type BankPayoutTransferPort,
  type PayoutTransferBatchRef,
  type PayoutTransferItem,
  type TransferError,
} from '@/modules/payments/application/ports/bank-payout-transfer.port.js'

const MOCK_BATCH_REF_PREFIX = 'mock_batch_'

/** См. JSDoc файла «СИМУЛЯЦИЯ ЧАСТИЧНОГО СБОЯ ДЛЯ ТЕСТОВ». Экспортирован — тесты конструируют
 * `pharmacyMerchantRef` этим значением напрямую, без второго тестового API мока. */
export const MOCK_PAYOUT_FORCE_UNCONFIRMED_REF = 'mock_force_unconfirmed_ref'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

@Injectable()
export class MockBankPayoutTransferProvider implements BankPayoutTransferPort {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public async transferBatch(payouts: readonly PayoutTransferItem[]): Promise<Result<PayoutTransferBatchRef, TransferError>> {
    if (this.config.mockPayoutDelayMs > 0) {
      await sleep(this.config.mockPayoutDelayMs)
    }
    const batchRef = `${MOCK_BATCH_REF_PREFIX}${randomUUID()}`
    const confirmed = payouts.filter((p) => p.pharmacyMerchantRef !== MOCK_PAYOUT_FORCE_UNCONFIRMED_REF)

    if (confirmed.length === payouts.length) {
      return { ok: true, value: { batchRef } }
    }
    if (confirmed.length === 0) {
      // Весь батч «неподтверждён» — нет частичного успеха, обычный полный отказ.
      return { ok: false, error: { code: 'ALL_UNCONFIRMED', message: 'mock: все строки батча симулированы как неподтверждённые' } }
    }
    return {
      ok: false,
      error: {
        code: 'PARTIAL_TRANSFER_FAILURE',
        message: `mock: ${String(payouts.length - confirmed.length)} из ${String(payouts.length)} строк батча симулированы как неподтверждённые`,
        partialSuccess: { batchRef, confirmedPayoutScheduleIds: confirmed.map((p) => p.payoutScheduleId) },
      },
    }
  }
}
