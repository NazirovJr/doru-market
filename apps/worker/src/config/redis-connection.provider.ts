import type { Provider } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import IORedis, { type Redis } from 'ioredis'
import type { WorkerEnv } from './env.schema.js'

/**
 * Общее соединение ioredis: используется и health-check'ом (`common/health`), и BullMQ
 * (`jobs/outbox-relay`) — одно соединение на процесс, а не по клиенту на потребителя.
 * `maxRetriesPerRequest: null` обязателен для BullMQ (блокирующие команды `Worker`/`Queue`,
 * см. документацию bullmq — без этой опции воркер не может ждать джобы через BRPOPLPUSH).
 */
export const REDIS_CONNECTION = Symbol('REDIS_CONNECTION')

export const redisConnectionProvider: Provider = {
  provide: REDIS_CONNECTION,
  useFactory: (configService: ConfigService<WorkerEnv, true>): Redis =>
    new IORedis(configService.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: null }),
  inject: [ConfigService],
}
