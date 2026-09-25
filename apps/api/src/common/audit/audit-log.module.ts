/**
 * `AuditLogModule` (EP-16, DTJ-374, SRS-ADM-001/062-064) — DI для `AuditLogPort`.
 *
 * **`@Global()` — ЕДИНСТВЕННОЕ сознательное исключение из правила проекта «модуль
 * подключается явным `imports: [...]` в каждом потребителе» (`docs/02-CLEAN-ARCHITECTURE-
 * AND-CODE.md` §1.3, `AGENTS.md` правило 2).** Обоснование зафиксировано тикетом DTJ-374
 * («Что сделать» п.5 и «Риски»): `audit_log` — СКВОЗНОЙ инфраструктурный сервис
 * (`SRS-ADM-001`: «пишется из ЛЮБОГО модуля через общий порт `AuditLogPort`, не собственный
 * bounded context»), а не bounded context с узким, заранее известным кругом потребителей.
 * Число потребителей растёт с каждым чувствительным админ-действием — уже известны
 * `DTJ-354` (grant-platform-role), `DTJ-356` (payment-override/force-cancel), `DTJ-359`
 * (billing lift-block), `DTJ-376`, и любой будущий модуль `EP-10`/`EP-14`/новых эпиков.
 * Явный `imports: [AuditLogModule]` в КАЖДОМ таком модуле создавал бы избыточный шум без
 * архитектурной пользы — в отличие от `AuthModule`/`TenancyModule` и т.п., где список
 * потребителей УЗКИЙ и явный импорт документирует РЕАЛЬНУЮ, узкую границу зависимости.
 *
 * НЕ ПУТАТЬ с `OrdersModule` (`modules/orders/orders.module.ts`) — тот тоже `@Global()`, но по
 * СОВСЕМ ДРУГОЙ, узкой причине (разрыв DI-цикла `orders`↔`payments`, см. её собственный JSDoc):
 * это НЕ прецедент «широкой переиспользуемости», у неё ОДИН реальный кросс-модульный
 * потребитель. `AuditLogModule` — единственный `@Global()` именно по мотиву «слишком много
 * текущих и будущих потребителей, чтобы оправдать явный импорт в каждом» — `DatabaseModule`/
 * `RedisModule`/`LoggerModule`/`IdempotencyModule`/`SharedKernelModule` глобальны как
 * фундаментальная платформенная инфраструктура волны 1 (EP-01, до и вне периметра правила
 * «явный импорт бизнес-модуля»), не как прецедент для бизнес-модулей вроде этого.
 *
 * РЕВЬЮЕР: не копировать этот приём на другие БИЗНЕС-модули по аналогии («у нас тоже много
 * потребителей») без такого же явного архитектурного обоснования — см.
 * `tickets/ep09-admin-notify-analytics/DTJ-374.md`, раздел «Риски».
 *
 * `AUDIT_LOG_QUERY_PORT` НЕ в `exports:` (в отличие от `AUDIT_LOG_PORT`) — read-порт резолвится
 * только `ListAuditLogUseCase`, зарегистрированному в этом же модуле.
 */
import { Global, Module } from '@nestjs/common'
import { AuthModule } from '@/modules/auth/index.js'
import { AUDIT_LOG_PORT } from './audit-log.port.js'
import { AUDIT_LOG_PORT_PROVIDER, AUDIT_LOG_QUERY_PORT_PROVIDER } from './infrastructure/audit-log.repository.js'
import { ListAuditLogUseCase } from './application/use-cases/list-audit-log.use-case.js'
import { AuditLogController } from './presentation/audit-log.controller.js'
import { AUDIT_RETENTION_CONFIG, AUDIT_RETENTION_CONFIG_PROVIDER } from './config/audit-retention.config.js'

@Global()
@Module({
  imports: [AuthModule],
  controllers: [AuditLogController],
  providers: [AUDIT_LOG_PORT_PROVIDER, AUDIT_LOG_QUERY_PORT_PROVIDER, ListAuditLogUseCase, AUDIT_RETENTION_CONFIG_PROVIDER],
  exports: [AUDIT_LOG_PORT, AUDIT_RETENTION_CONFIG],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class AuditLogModule {}
