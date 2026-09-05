/**
 * Публичный фасад модуля `returns` (EP-11, DTJ-270, скаффолдинг).
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2: единственный легальный путь межмодульного
 * взаимодействия для чужих bounded contexts. Импорт `modules/returns/domain|application|
 * infrastructure|presentation` напрямую — блокирующее нарушение (`dependency-cruiser`,
 * `no-cross-module-deep-import`). Тот же приём, что `modules/payments/index.ts`
 * (`PAYMENTS_FACADE`).
 *
 * На этом шаге (DTJ-270) `ReturnsFacade` — ПУСТОЙ контракт: ни одного use case модуля ещё не
 * реализовано (домен — DTJ-271, финансовая политика — DTJ-272, use case'ы — DTJ-273, вне
 * периметра этой волны). Токен `RETURNS_FACADE` объявлен здесь заранее (потребители — будущие
 * модули, читающие статус возврата), но НЕ забинжен ни к одному провайдеру в
 * `returns.module.ts` до появления первой реализации — попытка `@Inject(RETURNS_FACADE)` до
 * этого момента упадёт на резолвинге DI (осознанно: несуществующая реализация не маскируется
 * null-адаптером, т.к. ни один потребитель ещё не написан, правило 15 AGENTS.md неприменимо —
 * маркер нужен только когда ЕСТЬ вызывающий код).
 *
 * Интерфейс `ReturnsFacade` появится в этом файле ДОБАВЛЕНИЕМ (D-27), когда первый use case
 * модуля будет готов (DTJ-273+) — TypeScript не позволяет объявить непустой контракт без
 * реальных членов заранее, а пустой `interface {}` эквивалентен `unknown`/`object` и запрещён
 * линтером (`@typescript-eslint/no-empty-object-type`) как вводящий в заблуждение.
 */

/** DI-токен для будущего провайдера `ReturnsFacade` (`{ provide: RETURNS_FACADE, useClass: ... }`). */
export const RETURNS_FACADE = Symbol.for('@dorutj/returns/returns-facade')
