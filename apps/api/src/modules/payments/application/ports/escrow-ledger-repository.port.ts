/**
 * Порт `EscrowLedgerRepository` (EP-10, DTJ-240, SRS-PAY-011, `21-module-orders-payments-
 * escrow.md` §4.2) — append-only персистентность `EscrowLedgerEntry`.
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3: порт объявляется в `application/ports/*.port.ts`,
 * реализация — `infrastructure/repositories/escrow-ledger.repository.ts`
 * (`DrizzleEscrowLedgerRepository`, тот же тикет). Ticket/спека называют канонический файл
 * репозитория путём `infrastructure/repositories/escrow-ledger.repository.ts` — здесь
 * добавлен ЭТОТ файл-порт (не в буквальном `files_owned` DTJ-240) по обязательному правилу
 * `02` §1.3, а не по вкусу: без отдельного порта `application`-слой (будущие use case'ы
 * `CaptureEscrowUseCase`/`RefundOrderUseCase`/`AdjustLedgerUseCase`, DTJ-244..246) был бы
 * вынужден импортировать конкретный Drizzle-класс из `infrastructure/**`, что
 * `dependency-cruiser`-правило `application-does-not-know-infrastructure`
 * (`reports/EP09-CTO-BRIEF.md` §6.1) отклоняет механически. См. отчёт сдачи DTJ-240, раздел
 * ДОПУЩЕНИЯ.
 *
 * КОМПИЛЯЦИОННАЯ ГАРАНТИЯ (AC4 DTJ-240, SRS-PAY-011): `update`/`delete` физически НЕ
 * объявлены в этом `interface` — вызов `repo.update(...)`/`repo.delete(...)` где угодно в
 * кодовой базе — ошибка TS2339 «Property does not exist», а не рантайм-проверка. Тест на это
 * — `infrastructure/repositories/escrow-ledger.repository.spec.ts` (не здесь: `application`
 * не может импортировать конкретную `infrastructure`-реализацию, см. её JSDoc). Дублируется
 * операционной гарантией уровня роли БД (`GRANT INSERT, SELECT` без `UPDATE, DELETE`,
 * SRS-DB-024/030, `migrations/0030_escrow_ledger_grants.sql` + `0031_app_role_privileges.sql`
 * — best-effort, см. отчёт сдачи).
 *
 * `tx` — непрозрачный дескриптор активной транзакции, тот же паттерн, что `OrderUnitOfWorkTx`
 * (`modules/orders/application/ports/order-repository.port.ts`, DTJ-227): SRS-DOM-032 требует
 * `platform_fee_captured`+`captured_to_pharmacy` В ОДНОЙ транзакции — вызывающий use case
 * передаёт один и тот же `tx` в оба `append()`.
 */
import type { EscrowEntryType, EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'

export const ESCROW_LEDGER_REPOSITORY = Symbol.for('@dorutj/payments/escrow-ledger-repository')

/** Непрозрачный дескриптор активной транзакции (см. JSDoc файла). */
export type EscrowLedgerUnitOfWorkTx = unknown

export interface EscrowLedgerRepository {
  /** Append-only вставка. Ни одного пути мутации существующей строки — см. JSDoc файла. */
  append(entry: EscrowLedgerEntry, tx?: EscrowLedgerUnitOfWorkTx): Promise<void>

  /**
   * Все записи заказа, упорядоченные по `created_at` — вход для `EscrowLedger.isBalanced()`.
   * `tenantId` — ПЕРВЫЙ обязательный параметр (SRS-API-043/046, замечание CTO при приёмке
   * DTJ-240): `escrow_ledger` своей колонки `tenant_id` не несёт (канонная схема Группы E,
   * не упущение) — скоуп идёт ТОЛЬКО через `orders.tenant_id`, см. JSDoc реализации. Чужой
   * `tenantId` ⇒ пустой массив (запись финансового журнала чужого тенанта не подтверждается
   * как существующая, SRS-API-046).
   */
  findByOrderId(tenantId: string, orderId: string): Promise<EscrowLedgerEntry[]>

  /**
   * Сумма `amount_diram` по заказу и типу проводки (`0n`, если записей нет). `tenantId` —
   * первый обязательный параметр, тот же тенант-скоуп через `orders`, что `findByOrderId`.
   */
  sumByType(tenantId: string, orderId: string, entryType: EscrowEntryType): Promise<bigint>
}
