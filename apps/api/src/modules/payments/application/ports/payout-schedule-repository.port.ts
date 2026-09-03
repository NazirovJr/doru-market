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

export interface PayoutScheduleRepository {
  /**
   * Given для заказа уже существует строка `payout_schedule` (пост-`delivered` случай, AC4
   * DTJ-245 — в R1 маловероятно на пути отмены/рефанда, но защита от программной ошибки) и её
   * `status !== 'reversed'` → переводит в `'reversed'`, возвращает `true`. Given строки нет
   * ИЛИ она уже `'reversed'` → `false`, БЕЗ побочного эффекта (идемпотентно: повторный вызов на
   * уже реверснутой строке не пишет вторую мутацию впустую).
   */
  reverseIfExists(tenantId: string, orderId: string, tx?: PayoutScheduleUnitOfWorkTx): Promise<boolean>
}
