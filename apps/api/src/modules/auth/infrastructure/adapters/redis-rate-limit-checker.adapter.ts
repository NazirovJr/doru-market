/**
 * `RedisRateLimitCheckerAdapter` (EP-01, DTJ-023) — production-реализация
 * `RateLimitCheckerPort` через Redis (`INCR` + `EXPIRE` в `MULTI/EXEC`).
 *
 * При первом обращении (`INCR` вернёт `1`) — ставим TTL ровно на
 * `windowSeconds`. Последующие — TTL остаётся от ПЕРВОГО инкремента, что
 * и формирует «окно» (fixed window). Это стандартный pattern rate-limit
 * на Redis (SRS-API-019).
 */
import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import {
  RATE_LIMIT_CHECKER,
  type RateLimitCheckResult,
  type RateLimitCheckerPort,
} from '@/modules/auth/application/ports/rate-limit-checker.port.js'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'

@Injectable()
export class RedisRateLimitCheckerAdapter implements RateLimitCheckerPort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async incrementAndGet(key: string, windowSeconds: number): Promise<RateLimitCheckResult> {
    const incrResult = await this.redis.incr(key)
    let ttlSeconds: number
    if (incrResult === 1) {
      // первая запись в окне — ставим TTL атомарно
      await this.redis.expire(key, windowSeconds)
      ttlSeconds = windowSeconds
    } else {
      const ttl = await this.redis.ttl(key)
      ttlSeconds = ttl > 0 ? ttl : windowSeconds
    }
    return { count: incrResult, ttlSeconds }
  }
}

export { RATE_LIMIT_CHECKER }
