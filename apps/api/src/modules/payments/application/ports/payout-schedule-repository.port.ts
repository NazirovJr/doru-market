/**
 * Порт `PayoutScheduleRepository` (EP-10, DTJ-245) — минимальный доступ к `payout_schedule`,
 * нужный ТОЛЬКО `RefundOrderUseCase` (AC4 DTJ-245: пост-`delivered` рефанд обязан перевести
 * уже существующую строку `payout_schedule` в `status='reversed'`, SRS-PAY-015/017). Заведён
 * ЭТИМ тикетом, НЕ в буквальном `files_owned` DTJ-245 (`refund-order.use-case.ts`/
 * `refund-facade.adapter.ts`) — тот же приём, что `escrow-ledger-repository.port.ts` (DTJ-240
 * JSDoc: «добавлен... по обязательному правилу 02 §1.3, а не по вкусу» — без отдельного порта
 * `application`-слой был бы вынужден импортировать конкретный Drizzle-класс из
 * `infrastructure/**`, что `dependency-cruiser` (`application-does-not-know-infrastructure`)
 * отклоняет механически).
 *
 * `tenantId` — первый обязательный параметр (SRS-API-043/046, тот же паттерн, что
 * `EscrowLedgerRepository.sumByType`): `payout_schedule` своей колонки `tenant_id` не несёт
 * (DDL `db/schema/payments.ts`) — скоуп идёт ТОЛЬКО через `orders.tenant_id`.
 *
 * `tx` — непрозрачный дескриптор активной транзакции, тот же паттерн, что
 * `EscrowLedgerUnitOfWorkTx`.
 */
export const PAYOUT_SCHEDULE_REPOSITORY = Symbol.for('@dorutj/payments/payout-schedule-repository')

/** Непрозрачный дескриптор активной транзакции (см. JSDoc файла). */
export type PayoutScheduleUnitOfWorkTx = unknown

/** ДОБАВЛЕНО (DTJ-244) — вход `insertPending` (SRS-PAY-031). `orderId UNIQUE` (DDL) — конфликт
 * (заказ уже имеет строку, двойная доставка `OrderDeliveredEvent`) → `ON CONFLICT DO NOTHING`,
 * не ошибка (идемпотентность здесь — на уровне `ProcessedEventsPort`, ЭТА защита вторична). */
export interface InsertPendingPayoutInput {
  readonly orderId: string
  readonly pharmacyId: string
  readonly grossAmountDiram: bigint
  readonly commissionDiram: bigint
  readonly netAmountDiram: bigint
  /** Снэпшот `tenant_settings.hold_period_days` НА МОМЕНТ `delivered` (не пересчитывается позже). */
  readonly holdPeriodDays: number
}

export interface PayoutScheduleRepository {
  /**
   * Given для заказа уже существует строка `payout_schedule` (пост-`delivered` случай, AC4
   * DTJ-245 — в R1 маловероятно на пути отмены/рефанда, но защита от программной ошибки) и её
   * `status !== 'reversed'` → переводит в `'reversed'`, возвращает `true`. Given строки нет
   * ИЛИ она уже `'reversed'` → `false`, БЕЗ побочного эффекта (идемпотентно: повторный вызов на
   * уже реверснутой строке не пишет вторую мутацию впустую).
   */
  reverseIfExists(tenantId: string, orderId: string, tx?: PayoutScheduleUnitOfWorkTx): Promise<boolean>

  /** (DTJ-244) — создаёт строку `status='pending'` при `OrderDeliveredEvent` (SRS-PAY-031). */
  insertPending(input: InsertPendingPayoutInput, tx?: PayoutScheduleUnitOfWorkTx): Promise<void>

  /**
   * ДОБАВЛЕНО (DTJ-249, SRS-DOM-058/105) — контракт заморозки выплаты по спору, нужен ТОЛЬКО
   * `HoldPayoutUseCase` (PaymentsFacade.holdPayout, публичный контракт для EP-14). Тот же приём,
   * что `reverseIfExists`/DTJ-245 выше: заведён ЭТИМ тикетом, не буквальным `files_owned`
   * DTJ-249 (`hold-payout.use-case.ts`) — интерфейс порта живёт при своём репозитории, не при
   * use case'е (`02` §1.3).
   *
   * Объект-параметр `HoldIfPendingInput` (не 3 отдельных строковых аргумента) — `max-params`
   * ≤3 (C5): с опциональным `tx` это было бы 4 позиционных параметра.
   *
   * `UPDATE ... WHERE status IN ('pending','due')` — одна круговая поездка, не
   * check-then-write. `held=false` (0 строк затронуто) — см. JSDoc `HoldPayoutUseCase` про
   * контракт `alreadyPaid`: единственный СЕГОДНЯ достижимый случай 0 строк — `status='paid'`
   * (пост-payout, AC3 тикета); `disputed`/`reversed`/несуществующая строка — тот же
   * ноль-эффект код-путь, EP-14 различит причину при необходимости (см. «Риски» тикета —
   * контракт зафиксирован как лучшее понимание на момент EP-10).
   */
  holdIfPending(input: HoldIfPendingInput, tx?: PayoutScheduleUnitOfWorkTx): Promise<{ held: boolean }>
}

/** Вход `holdIfPending` (см. её JSDoc про C5). */
export interface HoldIfPendingInput {
  readonly tenantId: string
  readonly orderId: string
  readonly disputeId: string
}
