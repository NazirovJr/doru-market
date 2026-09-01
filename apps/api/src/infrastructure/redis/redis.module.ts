/**
 * `RedisModule` — общий модуль инфраструктуры, экспортирующий `REDIS_CLIENT`.
 * `apps/api` единственный клиент, как и для Postgres.
 */
import { Global, Module } from '@nestjs/common'
import { REDIS_CLIENT, redisProvider } from './redis.provider.js'

@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class RedisModule {}
