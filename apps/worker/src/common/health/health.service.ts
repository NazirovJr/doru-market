import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Redis } from 'ioredis'
// @/ алиас НЕ резолвится в раннтайме: nest-cli.json использует дефолтный tsc-билдер без
// webpack/tsconfig-paths (эмпирически проверено, DTJ-002) — `node dist/main.js` упал бы с
// ERR_MODULE_NOT_FOUND на буквальном `@/...`. Относительный путь до правки nest-cli.json.
// eslint-disable-next-line no-restricted-imports
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'

/** Сколько ждём ответа Redis, прежде чем считать его недоступным (SRS-NFR-037). */
const HEALTH_CHECK_TIMEOUT_MS = 2000

/**
 * `apps/worker` не разделяет liveness/readiness как `apps/api` — единственный `GET /health`
 * проверяет соединение с Redis/BullMQ (SRS-NFR-037: «apps/worker несёт свой GET /health...
 * проверяет соединение с BullMQ/Redis, т.к. воркер не обслуживает HTTP-трафик клиентов»).
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)

  constructor(@Inject(REDIS_CONNECTION) private readonly redis: Redis) {}

  async checkRedisConnection(): Promise<boolean> {
    try {
      await Promise.race([this.redis.ping(), this.createTimeout()])
      return true
    } catch (error) {
      this.logger.warn(`health-check: Redis недоступен — ${String(error)}`)
      return false
    }
  }

  private createTimeout(): Promise<never> {
    return new Promise((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('health-check: таймаут ожидания Redis'))
      }, HEALTH_CHECK_TIMEOUT_MS)
    })
  }
}
