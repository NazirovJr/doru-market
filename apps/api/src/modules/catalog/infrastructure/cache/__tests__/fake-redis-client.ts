/**
 * `FakeRedisClient` — тестовый двойник `ioredis` для unit-тестов
 * `SearchCacheService`/`RedisLockGuard` (DTJ-187).
 *
 * НЕ заменяет требуемые тест-планом тикета интеграционные тесты против РЕАЛЬНОГО Redis
 * (`../../../test/integration/catalog/*.integration.spec.ts`, Ж13/тест-план DTJ-187:
 * «реальная атомарность SET NX PX важна для этой логики»). Этот двойник проверяет
 * КООРДИНАЦИОННУЮ ЛОГИКУ `RedisLockGuard`/`SearchCacheService` (кто вызывает `compute()`,
 * когда лок освобождается, что читают конкурентные вызовы) в рамках ОДНОГО Node-процесса:
 * `set()` реализован без `await` между проверкой NX и записью, поэтому для конкурентных
 * `Promise.all`-вызовов внутри одного процесса воспроизводит ту же атомарность
 * check-then-write, что гарантирует Redis на своей стороне — этого достаточно, чтобы
 * ловить баги В САМОЙ ЛОГИКЕ (например, «второй вызов тоже получил лок»), но не заменяет
 * проверку реального протокола/сети.
 */
export class FakeRedisClient {
  private readonly store = new Map<string, { readonly value: string; readonly expiresAt: number | null }>()

  private readLive(key: string): string | null {
    const entry = this.store.get(key)
    if (entry === undefined) {
      return null
    }
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  async get(key: string): Promise<string | null> {
    return Promise.resolve(this.readLive(key))
  }

  async del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0)
  }

  /**
   * Покрывает ровно те перегрузки `ioredis#set`, которые использует продакшен-код этого
   * тикета: `SET key value PX ms`, `SET key value PX ms NX`, `SET key value EX seconds`.
   * Хвостовые TTL-аргументы приняты через один rest-параметр (не 3 позиционных) — иначе
   * `max-params` (C5, ≤3) не пропускает сигнатуру.
   */
  async set(
    key: string,
    value: string,
    ...ttlArgs: readonly ['PX' | 'EX', number] | readonly ['PX' | 'EX', number, 'NX']
  ): Promise<'OK' | null> {
    const [ttlToken, ttlAmount, nx] = ttlArgs
    if (nx === 'NX' && this.readLive(key) !== null) {
      return Promise.resolve(null)
    }
    const expiresAt = ttlToken === 'PX' ? Date.now() + ttlAmount : Date.now() + ttlAmount * 1000
    this.store.set(key, { value, expiresAt })
    return Promise.resolve('OK')
  }
}
