/**
 * `DatabaseModule` — общий модуль инфраструктуры БД, экспортирующий
 * `DRIZZLE_DB` токен (DTJ-052 требует). Помечен `@Global()` — репозитории
 * из любого `modules/<context>/infrastructure/repositories/*` могут инжектировать
 * Drizzle-клиент без повторного импорта модуля.
 */
import { Global, Module } from '@nestjs/common'
import { DRIZZLE_DB, drizzleProvider } from './drizzle.provider.js'

@Global()
@Module({
  providers: [drizzleProvider],
  exports: [DRIZZLE_DB],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class DatabaseModule {}
