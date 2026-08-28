import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'
// no-restricted-imports (C16) требует alias @/..., но эмитируемый tsc/`nest build` JS
// оставляет `@/...` нерезолвленным для нативного Node ESM (нет bundler-шага в этом
// тикете — см. `assumptions` DTJ-001); относительный путь — единственный рабочий вариант
// без новых зависимостей (`tsc-alias` и т.п.), поэтому здесь допускается `../../`.
// eslint-disable-next-line no-restricted-imports
import { AppConfigModule } from '../../config/config.module.js'
import { HealthController } from './health.controller.js'
import { EventLoopLagIndicator } from './event-loop-lag.indicator.js'
import { PostgresReadinessIndicator } from './postgres-readiness.indicator.js'
import { RedisReadinessIndicator } from './redis-readiness.indicator.js'
import { ReadinessIndicators } from './readiness-indicators.service.js'

/** DTJ-001, шаг 6: `GET /health` + `GET /ready` (SRS-NFR-037). */
@Module({
  imports: [TerminusModule, AppConfigModule],
  controllers: [HealthController],
  providers: [
    EventLoopLagIndicator,
    PostgresReadinessIndicator,
    RedisReadinessIndicator,
    ReadinessIndicators,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS-модуль: пустое тело класса — его контракт, вся конфигурация в декораторе @Module(...) выше.
export class HealthModule {}
