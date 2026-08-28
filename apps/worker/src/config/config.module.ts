import { Global, Module } from '@nestjs/common'
import { ConfigModule as NestConfigModule } from '@nestjs/config'
import { validateWorkerEnv } from './env.schema.js'
import { redisConnectionProvider, REDIS_CONNECTION } from './redis-connection.provider.js'

/**
 * Глобальный модуль конфигурации apps/worker: валидирует ENV на старте (`env.schema.ts`) и
 * предоставляет общее соединение Redis (`REDIS_CONNECTION`) остальным модулям процесса.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateWorkerEnv,
    }),
  ],
  providers: [redisConnectionProvider],
  exports: [NestConfigModule, REDIS_CONNECTION],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- носитель декоратора @Module.
export class ConfigModule {}
