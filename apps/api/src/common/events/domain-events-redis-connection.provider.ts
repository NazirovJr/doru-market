import type { Provider } from '@nestjs/common'
import Redis from 'ioredis'
import { AppConfigService } from '@/config/app-config.service.js'

export const DOMAIN_EVENTS_REDIS_CONNECTION = Symbol.for('@dorutj/common/domain-events-redis-connection')

// Отдельное соединение (не общий REDIS_CLIENT): BullMQ Worker требует maxRetriesPerRequest: null.
export const domainEventsRedisConnectionProvider: Provider = {
  provide: DOMAIN_EVENTS_REDIS_CONNECTION,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService): Redis => {
    const client = new Redis(config.redisUrl, { maxRetriesPerRequest: null })
    client.on('error', () => undefined)
    return client
  },
}
