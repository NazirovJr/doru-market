/**
 * `RateLimitCheckerPort` (EP-01, DTJ-023) — минимальный контракт для проверки
 * инкрементирующих счётчиков rate-limit. Полная реализация DTJ-020 (`RateLimitGuard`,
 * `@RateLimit` декоратор) — отдельный тикет, здесь достаточно уметь:
 *
 *   - увеличить счётчик по ключу (Redis INCR + EXPIRE);
 *   - вернуть текущее значение счётчика и TTL для `Retry-After` header.
 *
 * Ключи формируются вызывающим кодом (use case) — здесь только
 * `incrementAndGet(key, windowSeconds)`. Это сознательное сужение scope: четыре
 * разных лимита OTP (cooldown 60с / 10мин / 24ч по телефону + 1ч по IP) различаются
 * окнами, и DTJ-023 §«Риски» явно предлагает НЕ делать одну Lua-скрипт-транзакцию
 * для R1 — четыре независимых `incrementAndGet` дешевле и проще для ревью.
 */
export const RATE_LIMIT_CHECKER = Symbol.for('@dorutj/auth/rate-limit-checker')

export interface RateLimitCheckResult {
  /** Текущее значение счётчика ПОСЛЕ инкремента. `1` = первый запрос в окне. */
  readonly count: number
  /** TTL оставшегося окна (секунды). Используется для `Retry-After` header. */
  readonly ttlSeconds: number
}

export interface RateLimitCheckerPort {
  /**
   * INCR по ключу; если ключ только что создан — ставит EXPIRE на `windowSeconds`.
   * Атомарность — обязанность реализации (Redis `INCR` атомарен, EXPIRE ставится
   * первым вызовом через `SET ... NX EX` или в `MULTI/EXEC`).
   */
  incrementAndGet(key: string, windowSeconds: number): Promise<RateLimitCheckResult>
}
