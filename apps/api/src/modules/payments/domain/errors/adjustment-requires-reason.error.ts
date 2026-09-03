/**
 * `AdjustmentRequiresReasonError` (EP-10, DTJ-240, SRS-DOM-035, `21-module-orders-payments-
 * escrow.md` §4.1) — конструктор `EscrowLedgerEntry` с `entryType='adjustment'` без непустых
 * `reason`/`actorUserId`.
 *
 * Первый рубеж защиты уровня домена — зеркалит БД-констрейнт
 * `chk_escrow_ledger_adjustment_requires_reason` (`migrations/0029_payments.sql`), второй
 * рубеж. Обход агрегата (сырой SQL/скрипт) домен не защищает — за это отвечает констрейнт.
 *
 * Локальное определение (не `packages/contracts`) — тот же приём, что `payment-provider.
 * error.ts` этого же модуля (DTJ-237): `domain/` `payments` не зависит от общего каталога
 * ошибок EP-01, остаётся переносимым без инфраструктуры. НЕ наследует `PaymentProviderError`
 * — это ошибка инварианта ledger'а, а не сбой банковского провайдера, общий предок этих двух
 * семейств семантически неверен.
 */
const ADJUSTMENT_REQUIRES_REASON_CODE = 'ADJUSTMENT_REQUIRES_REASON'

export class AdjustmentRequiresReasonError extends Error {
  public readonly code = ADJUSTMENT_REQUIRES_REASON_CODE

  public constructor(public readonly orderId: string) {
    super(
      `EscrowLedgerEntry(entryType='adjustment') for order "${orderId}" requires non-empty reason and actorUserId (SRS-DOM-035)`,
    )
    this.name = new.target.name
  }
}
