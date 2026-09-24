/** Отдельное ioredis-соединение для BullMQ `Worker` (требует `maxRetriesPerRequest: null`, в отличие от общего REDIS_CLIENT). */
import type { Provider } from '@nestjs/common'
import Redis from 'ioredis'
import { AppConfigService } from '@/config/app-config.service.js'

export const DOMAIN_EVENTS_WORKER_REDIS_CONNECTION = Symbol.for('@dorutj/notifications/domain-events-worker-redis-connection')

export const domainEventsWorkerConnectionProvider: Provider = {
  provide: DOMAIN_EVENTS_WORKER_REDIS_CONNECTION,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): Redis => {
    const client = new Redis(config.redisUrl, { maxRetriesPerRequest: null })
    client.on('error', () => undefined) // без listener'а ioredis роняет процесс на unhandled 'error'
    return client
  },
}
