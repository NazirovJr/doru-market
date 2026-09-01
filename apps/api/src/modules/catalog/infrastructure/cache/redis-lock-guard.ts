/**
 * `RedisLockGuard` (DTJ-187, EP-06 «Умный поиск», SRS-CAT-060) — защита от cache stampede.
 *
 * **Слой и границы.** Чистая infrastructure-утилита (`02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §1: адаптер, НЕ доменная логика — ни одного доменного инварианта, только координация
 * через Redis). По прямому указанию тикета DTJ-187 «Риски и подводные камни» — общая
 * утилита, потенциально полезная другим модулям (например, `inventory`-синхронизации), но
 * НЕ выносится в `packages/shared` до появления ВТОРОГО реального потребителя за пределами
 * `catalog` (C15, преждевременная абстракция). Появится второй потребитель — перенос
 * отдельным рефакторинг-тикетом, не блокирует R1.
 *
 * **Механизм (SRS-CAT-060, буквально «`SET key value NX PX ttl`»).** Один и тот же `key`
 * используется И как мьютекс, И как итоговое место хранения результата — так конкурентным
 * вызовам не нужен отдельный канал передачи значения от победителя гонки к проигравшим:
 *
 *   1. `SET key <PLACEHOLDER> NX PX ttlMs` — атомарная попытка захвата.
 *   2. Лок захвачен (`'OK'`) → выполняется `compute()`.
 *      - Успех: результат сериализуется и ПЕРЕЗАПИСЫВАЕТ тот же `key`
 *        (`SET key <json> PX ttlMs`, без `NX`) — лок естественно «снимается», последующие
 *        читатели видят готовое значение.
 *      - Ошибка: `key` УДАЛЯЕТСЯ (лок явно освобождается, не висит до истечения `ttlMs`,
 *        `AGENTS.md` C12 — запрет пустого `catch`/проглатывания) и исключение
 *        пробрасывается вызывающему коду (DTJ-187, критерий приёмки 4).
 *   3. Лок НЕ захвачен → конкурентный вызов ждёт `STAMPEDE_RETRY_DELAY_MS` (`50мс`), затем
 *      читает `key`; если там всё ещё PLACEHOLDER — повторяет, максимум
 *      `STAMPEDE_RETRY_ATTEMPTS` (`3`) раз подряд; как только видит реальное значение —
 *      парсит и возвращает его, НЕ вызывая `compute()` повторно (DTJ-187, критерий 1).
 *
 * **Что класс НАМЕРЕННО не делает.** В отличие от `RedisTenantCacheAdapter`
 * (`modules/tenancy/infrastructure/adapters/tenant-cache.adapter.ts`, SRS-TEN-006), этот
 * класс НЕ глотает ошибку самого Redis-вызова `SET ... NX` при захвате лока — сбой
 * распространяется вызывающему коду как есть, тем же приёмом, что уже применяет
 * `RedisRateLimitCheckerAdapter` (`modules/auth/infrastructure/adapters/redis-rate-limit-
 * checker.adapter.ts`): этот класс координирует ВЫПОЛНЕНИЕ дорогого вычисления, а не читает
 * опциональный кэш — молчаливая деградация в «просто выполни `compute()` без лока» при
 * сбое Redis непредсказуемо разрешила бы ровно тот параллелизм, для защиты от которого
 * класс существует (SRS-CAT-060).
 *
 * @see docs/spec/20-module-catalog-search.md (§11, SRS-CAT-060)
 * @see tickets/ep05-search-map/DTJ-187.md
 */
import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

/** SRS-CAT-060, буквально «50мс × 3». Именованные константы — не магические числа (C6, DoD). */
export const STAMPEDE_RETRY_DELAY_MS = 50
export const STAMPEDE_RETRY_ATTEMPTS = 3

/** Ответ `ioredis` на успешный `SET ... NX` (см. RedisCommander.d.ts). */
const LOCK_ACQUIRED_REPLY = 'OK'

/**
 * Маркер «вычисление ещё в процессе» — записывается в `key` НА ВРЕМЯ выполнения `compute()`.
 * Не является валидным JSON-значением результата (`SearchResultPage`/`SuggestItem[]`
 * сериализуются в `{...}`/`[...]`), поэтому не может быть спутан с реальным ответом.
 * Экспортирован ТОЛЬКО ради unit-теста «исчерпаны retry-попытки» (`redis-lock-guard.spec.ts`),
 * который иначе не может детерминированно смоделировать «держателя лока, не завершившего
 * compute()» без обращения к этому же значению.
 */
export const LOCK_PLACEHOLDER_VALUE = '__DTJ_LOCK_PENDING__'

/**
 * Бросается, когда конкурентный вызов исчерпал все `STAMPEDE_RETRY_ATTEMPTS` попыток, а
 * держатель лока так и не опубликовал результат. Спецификацией явно НЕ описано (не покрыто
 * критериями приёмки DTJ-187) — ASSUMPTION: типизированный отказ вместо тихого зависания
 * или `undefined` (C12, честная обработка ошибок).
 */
export class CacheStampedeUnresolvedError extends Error {
  constructor(readonly key: string) {
    super(
      `RedisLockGuard: результат для ключа "${key}" не появился после ${String(STAMPEDE_RETRY_ATTEMPTS)} попыток`,
    )
    this.name = 'CacheStampedeUnresolvedError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

@Injectable()
export class RedisLockGuard {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Выполняет `compute()` РОВНО ОДИН раз среди конкурентных вызовов с одинаковым `key` в
   * узком окне (DTJ-187, критерий приёмки 1). `ttlMs` — одновременно верхняя граница
   * удержания лока (страховка на случай падения процесса-держателя) и TTL опубликованного
   * результата — единственный параметр тикета, обе роли неразделимы намеренно.
   */
  async withLock<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const acquired = await this.redis.set(key, LOCK_PLACEHOLDER_VALUE, 'PX', ttlMs, 'NX')
    if (acquired === LOCK_ACQUIRED_REPLY) {
      return this.runAndPublish(key, ttlMs, compute)
    }
    return this.waitForResult<T>(key)
  }

  private async runAndPublish<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    try {
      const result = await compute()
      await this.redis.set(key, JSON.stringify(result), 'PX', ttlMs)
      return result
    } catch (error: unknown) {
      // Критерий приёмки 4: лок освобождается немедленно, не висит до истечения ttlMs.
      await this.redis.del(key)
      throw error
    }
  }

  private async waitForResult<T>(key: string): Promise<T> {
    for (let attempt = 0; attempt < STAMPEDE_RETRY_ATTEMPTS; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- намеренно последовательно: пауза МЕЖДУ попытками — суть retry-стратегии SRS-CAT-060 «50мс × 3», Promise.all здесь бессмысленен (нечего параллелить).
      await sleep(STAMPEDE_RETRY_DELAY_MS)
      // eslint-disable-next-line no-await-in-loop -- см. обоснование выше: читаем результат ПОСЛЕ паузы, не параллельно с ней.
      const raw = await this.redis.get(key)
      if (raw !== null && raw !== LOCK_PLACEHOLDER_VALUE) {
        return JSON.parse(raw) as T
      }
    }
    throw new CacheStampedeUnresolvedError(key)
  }
}
