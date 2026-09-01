/**
 * `UnitOfWorkPort` (EP-01, DTJ-024, SRS-API-071) — минимальный UoW-паттерн
 * для транзакционного доступа к БД.
 *
 * Контекст: `VerifyOtpUseCase` (§3.1-3.9) должен атомарно:
 *   1. Захватить блокировку строки `otp_codes` (`SELECT FOR UPDATE`).
 *   2. Проверить код / инкрементировать attempts / проверить rate-limit.
 *   3. Создать `auth_sessions`-запись.
 *   4. Пометить `otp_codes.consumed_at`.
 *
 * Если шаги 1-4 выполняются в разных транзакциях, `SRS-API-071` (гонка двух
 * вкладок) проявляется: первая доходит до БД с `consumed=true`, вторая
 * видит свежую строку и тоже считает себя успешной. UoW даёт `db.transaction`,
 * внутри которого все 4 шага выполняются в одной транзакции.
 *
 * Контракт:
 *   - `run<T>(callback): Promise<T>` — выполняет callback в транзакции.
 *     `callback` получает ТРАНЗАКЦИОННЫЙ клиент, к которому обращаются
 *     репозитории (см. `OtpCodesRepository.findByIdForUpdate(tx, id)`).
 *
 * Реализации:
 *   - `InMemoryUnitOfWorkAdapter` — заглушка для dev/тестов (атомарность
 *     обеспечивается синхронностью `Map`-операций; UoW.run = no-op).
 *   - Drizzle-реализация появится, когда БД будет доступна (corepack-баг,
 *     STATE-AND-RESUME §5.1) — `db.transaction(async (tx) => callback(tx))`.
 */
export const UNIT_OF_WORK = Symbol.for('@dorutj/auth/unit-of-work')

/**
 * Непрозрачный дескриптор транзакции (docs/05-DEVELOPER-HANDBOOK.md §18,
 * depcruise `application-does-not-know-infrastructure`): application-порт
 * не имеет права знать о конкретном типе БД (`DrizzleDb`) — только форму
 * «что-то, что передаётся дальше репозиториям». Конкретный тип известен
 * только infrastructure-реализации `UnitOfWorkPort` (Drizzle `NodePgDatabase`,
 * `null` в InMemory-режиме и т.п.) и репозиториям, которые она вызывает.
 */
export type UnitOfWorkTx = unknown

/** Callback получает тот же дескриптор транзакции (или sub-client в Drizzle-режиме). */
export type UnitOfWorkCallback<T> = (tx: UnitOfWorkTx) => Promise<T>

export interface UnitOfWorkPort {
  run<T>(callback: UnitOfWorkCallback<T>): Promise<T>
}
