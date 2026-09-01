/**
 * Провайдер общего Redis-клиента `apps/api` (DTJ-053). Один пул, переиспользуется
 * всеми модулями (tenancy, в будущем — notifications/sessions).
 *
 * `lazyConnect: true` + `maxRetriesPerRequest: 1` — соответствует NFR-037:
 * readiness-ответ не должен блокироваться реконнектами Redis.
 */
import type { Provider } from '@nestjs/common'
import Redis from 'ioredis'
import { AppConfigService } from '@/config/app-config.service.js'
import { REDIS_CLIENT } from './redis.token.js'

const REDIS_COMMAND_TIMEOUT_MS = 2000
const REDIS_MAX_RETRIES_PER_REQUEST = 1

// Re-export, чтобы RedisModule мог импортировать и токен, и провайдер из одного файла
// (ранее тип импортировал `REDIS_CLIENT` из './redis.provider.js' и получал "is not exported").
export { REDIS_CLIENT }

export const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): Redis => {
    const client = new Redis(config.redisUrl, {
      lazyConnect: true,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
    })
    // Без no-op listener ioredis роняет процесс на unhandled 'error' (например,
    // в момент обрыва соединения между readiness и первым использованием).
    // Обработка реальных ошибок — в вызывающем коде через try/catch на каждом
    // методе (graceful degradation, SRS-TEN-006).
    client.on('error', () => undefined)
    return client
  },
}
