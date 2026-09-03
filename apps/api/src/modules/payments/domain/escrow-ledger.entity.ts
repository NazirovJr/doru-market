/**
 * `EscrowLedger` (EP-10, DTJ-240) — обёртка над append-only коллекцией `EscrowLedgerEntry`
 * ОДНОГО заказа (`21-module-orders-payments-escrow.md` §4.1, SRS-DOM-033, SRS-PAY-010).
 *
 * В периметре ЭТОГО тикета несёт ЕДИНСТВЕННЫЙ метод — `isBalanced()`: чистая функция,
 * реализующая формулу инварианта реконсиляции БУКВАЛЬНО (SRS-PAY-010, не запрос к БД сама —
 * вызывающий код, `EscrowReconciliationJob`, DTJ-247, сам загружает записи через
 * `EscrowLedgerRepository.findByOrderId()`).
 *
 * НЕ добавляет допуск на погрешность округления (тикет DTJ-240, раздел «Риски»): любое,
 * даже однодирамовое расхождение — `false`. Заказ, у которого есть только `hold_created`
 * (оплачен, но ещё не доставлен), тоже `false` по буквальной формуле — это НЕ спецкейс,
 * которому нужен возврат `true`: тест-план тикета явно требует покрыть этот сценарий, чтобы
 * зафиксировать строгость (не дать будущей правке подсунуть «пока не доставлен — считаем
 * сбалансированным»). Пустой массив (не эскроу-заказ, cash_courier, §4.6) — `0 === 0` даёт
 * `true` без специального case'а: формула это уже покрывает.
 *
 * Мутирующие методы полного агрегата (`captureOnDelivery`/`refund`/`adjust`,
 * SRS-DOM-032/034/035, канонически описанные `10-domain-model.md` §«EscrowLedger — слой
 * domain») — ВНЕ `files_owned` этого тикета (DTJ-240 = domain VO + `isBalanced` +
 * репозиторий, `estimate: S`; тест-план тикета не требует их). Use case'ы-потребители
 * (`CaptureEscrowUseCase` DTJ-244, `RefundOrderUseCase` DTJ-245, `AdjustLedgerUseCase`
 * DTJ-246) конструируют `EscrowLedgerEntry.create(...)` и вызывают
 * `EscrowLedgerRepository.append()` напрямую — см. отчёт сдачи DTJ-240, раздел ДОПУЩЕНИЯ.
 */
import type { EscrowEntryType, EscrowLedgerEntry } from './escrow-ledger-entry.value-object.js'

const ZERO_DIRAM = 0n

const CREDIT_SIDE_ENTRY_TYPES: readonly EscrowEntryType[] = [
  'platform_fee_captured',
  'captured_to_pharmacy',
  'refunded_to_customer',
  'partially_refunded',
]

/**
 * Объектный литерал с методом, НЕ `class` (ESLint `@typescript-eslint/no-extraneous-class`:
 * класс с единственным static-методом и без состояния — запах «класс как неймспейс»). Имя
 * `EscrowLedger.isBalanced(entries)` — буквально то, что требует тикет (AC2/AC3) — сохранено
 * этим приёмом без искусственного `private constructor()`-обхода линтера.
 */
export const EscrowLedger = {
  /**
   * SRS-PAY-010 (буквально):
   *
   *   Σ(hold_created)
   *     ==
   *   Σ(platform_fee_captured) + Σ(captured_to_pharmacy)
   *     + Σ(refunded_to_customer) + Σ(partially_refunded)
   *     + Σ(adjustment, credit) − Σ(adjustment, debit)
   *
   * `entries` — записи ОДНОГО заказа (вызывающий код гарантирует это через
   * `findByOrderId(orderId)`; функция не проверяет однородность `orderId` — не её забота,
   * см. JSDoc файла).
   */
  isBalanced(entries: readonly EscrowLedgerEntry[]): boolean {
    const holdCreated = sumEntriesOfType(entries, 'hold_created')
    const creditSide = CREDIT_SIDE_ENTRY_TYPES.reduce((acc, type) => acc + sumEntriesOfType(entries, type), ZERO_DIRAM)
    const adjustmentNet = sumAdjustmentNet(entries)
    return holdCreated === creditSide + adjustmentNet
  },
}

function sumEntriesOfType(entries: readonly EscrowLedgerEntry[], entryType: EscrowEntryType): bigint {
  return entries
    .filter((entry) => entry.entryType === entryType)
    .reduce((acc, entry) => acc + entry.amountDiram.diram, ZERO_DIRAM)
}

/** `Σ(adjustment, credit) − Σ(adjustment, debit)` — знак кодирует `direction` (SRS-DOM-067). */
function sumAdjustmentNet(entries: readonly EscrowLedgerEntry[]): bigint {
  const adjustments = entries.filter((entry) => entry.entryType === 'adjustment')
  const credit = adjustments
    .filter((entry) => entry.direction === 'credit')
    .reduce((acc, entry) => acc + entry.amountDiram.diram, ZERO_DIRAM)
  const debit = adjustments
    .filter((entry) => entry.direction === 'debit')
    .reduce((acc, entry) => acc + entry.amountDiram.diram, ZERO_DIRAM)
  return credit - debit
}
