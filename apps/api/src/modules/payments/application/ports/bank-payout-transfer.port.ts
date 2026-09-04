/**
 * Порт `BankPayoutTransferPort` (EP-10, DTJ-250, `21-module-orders-payments-escrow.md` §6.3,
 * SRS-PAY-033/034) — Provider Pattern (Charter §3.3), СИММЕТРИЧНЫЙ `PaymentProvider` (DTJ-237),
 * но для батч-переводов на мерчант-счета аптек (`payout_schedule.due → paid`), а не для
 * клиентских платежей. Сигнатура — 1:1 по §6.3 (буквальная цитата спеки, дословно):
 * `transferBatch(payouts: readonly { payoutScheduleId, pharmacyMerchantRef, amountDiram }[]):
 * Promise<Result<{ batchRef: string }, TransferError>>`.
 *
 * DI-биндинг конкретного адаптера — `payments.module.ts`, ветка по `PAYOUT_DRIVER` (аналог
 * `PAYMENT_DRIVER`, SRS-PAY-009-подобный переключатель, но для выплат). Единственный R1-адаптер —
 * `MockBankPayoutTransferProvider` (DTJ-250); реальный банковский адаптер — R3, вне периметра.
 *
 * ФОРМА `TransferError` ПРИ ЧАСТИЧНОМ СБОЕ (SRS-PAY-034 — «часть строк переведена, часть — нет,
 * если адаптер это различает»): тикет прямо предлагает выбор между «раздельные списки в успешном
 * результате» ИЛИ «детализация в `TransferError`» и требует зафиксировать конкретную форму на
 * этапе реализации — выбрана ВТОРАЯ (детализация в `TransferError.partialSuccess`), потому что
 * ИМЕННО она сохраняет буквальную форму успешного результата `{ batchRef: string }` из SRS-PAY-033
 * без изменений (1:1 со спекой, а не расширение её типа) — успех остаётся «весь батч подтверждён»,
 * частичный случай — это `Err` с деталями о том, что всё-таки подтвердилось.
 */
import type { Result } from '@dorutj/domain-kernel'

/** DI-токен для провайдера `BankPayoutTransferPort` (`{ provide: BANK_PAYOUT_TRANSFER_PORT, useClass: ... }`). */
export const BANK_PAYOUT_TRANSFER_PORT = Symbol.for('@dorutj/payments/bank-payout-transfer-port')

export interface PayoutTransferItem {
  readonly payoutScheduleId: string
  readonly pharmacyMerchantRef: string
  readonly amountDiram: bigint
}

/** Успешный результат — ВЕСЬ переданный батч подтверждён ОДНИМ `batchRef` (SRS-PAY-033, 1:1). */
export interface PayoutTransferBatchRef {
  readonly batchRef: string
}

export interface TransferError {
  readonly code: string
  readonly message: string
  /**
   * SRS-PAY-034: при частичном сбое батча — какие из ЗАПРОШЕННЫХ `payoutScheduleId` всё же
   * подтверждены (и под каким `batchRef`) ДО того, как остаток батча не подтвердился.
   * `undefined` — адаптер НЕ различает частичный успех (весь батч трактуется как
   * неподтверждённый, ничего не помечается `paid` — безопасный дефолт SRS-PAY-034, «НЕ
   * оптимистичная пометка всего батча»).
   */
  readonly partialSuccess?: {
    readonly batchRef: string
    readonly confirmedPayoutScheduleIds: readonly string[]
  }
}

export interface BankPayoutTransferPort {
  transferBatch(payouts: readonly PayoutTransferItem[]): Promise<Result<PayoutTransferBatchRef, TransferError>>
}
