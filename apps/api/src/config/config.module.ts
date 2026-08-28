import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppConfigService } from './app-config.service.js'
import { validateEnv } from './env.schema.js'

/**
 * Единая точка чтения ENV (DTJ-001, шаг 3). `@Global()` — `AppConfigService` доступен без
 * повторного импорта в каждом `<context>.module.ts` следующих эпиков.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class AppConfigModule {}
