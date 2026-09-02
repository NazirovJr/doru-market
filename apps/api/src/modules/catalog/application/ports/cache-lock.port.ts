/**
 * Порт `CacheLockPort` (EP-06, DTJ-188/189) — граница `application` над `RedisLockGuard`
 * (DTJ-187, `infrastructure/cache/redis-lock-guard.ts`).
 *
 * **Почему это порт, а не прямая инъекция `RedisLockGuard` по классу.** JSDoc `RedisLockGuard`
 * и комментарий `catalog.module.ts` (DTJ-187) описывают приём «без Symbol-токена, потребители
 * (DTJ-188/189) инжектируют напрямую по классу через конструктор». Проверено эмпирически
 * (`npx depcruise --config .dependency-cruiser.cjs apps/api/src/modules/catalog` на пробном
 * файле, удалён после проверки, см. отчёт сдачи DTJ-188): прямой импорт `RedisLockGuard` из
 * `application/use-cases/*` ломает правило `application-does-not-know-infrastructure`
 * (`.dependency-cruiser.cjs`, `severity: 'error'`, `from: '/application/'` →
 * `to: '/(infrastructure|presentation)/'`) — намерение DTJ-187 и машинно проверяемая граница
 * архитектуры (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1/§1.3) прямо противоречат друг другу.
 * Это НЕ мой файл на правку (`infrastructure/cache/*` вне `files_owned` DTJ-188, Ж7), и
 * `.dependency-cruiser.cjs` трогать нельзя (Ж3 — «не отключай проверку ради зелёного гейта»),
 * поэтому решение — тонкий порт здесь (application), связанный с `RedisLockGuard` через
 * `useExisting` в `catalog.module.ts` (композиционный корень, ему обе стороны легитимны).
 * `RedisLockGuard` не переименован и не тронут — структурно совпадает с этим интерфейсом,
 * `useExisting` не требует явного `implements`.
 *
 * @see apps/api/src/modules/catalog/infrastructure/cache/redis-lock-guard.ts
 * @see tickets/ep05-search-map/DTJ-187.md
 * @see tickets/ep05-search-map/DTJ-188.md
 */

/** DI-токен NestJS для `CacheLockPort` (D-27). */
export const CACHE_LOCK_PORT = Symbol.for('@dorutj/catalog/cache-lock-port')

/** Зеркало сигнатуры `RedisLockGuard.withLock` (см. JSDoc файла — намеренно). */
export interface CacheLockPort {
  withLock<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T>
}
