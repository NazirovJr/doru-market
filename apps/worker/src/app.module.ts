import { Module } from '@nestjs/common'
import { HealthModule } from './common/health/health.module.js'
import { ConfigModule } from './config/config.module.js'
import { OutboxRelayModule } from './jobs/outbox-relay/outbox-relay.module.js'

/**
 * Барабанный модуль (D-27) — корневой `AppModule` apps/worker. Каждый новый тикет,
 * добавляющий джобу/модуль, правит этот файл ТОЛЬКО добавлением строки в `imports`, перечитав
 * файл непосредственно перед правкой. Инициализирован тикетом DTJ-002.
 */
@Module({
  imports: [ConfigModule, HealthModule, OutboxRelayModule],
})
// Класс существует только как носитель декоратора @Module для графа DI NestJS — штатный паттерн.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AppModule {}
