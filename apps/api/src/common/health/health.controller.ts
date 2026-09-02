import { Controller, Get, Inject } from '@nestjs/common'
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus'
import { Public } from './public.decorator.js'
import { EventLoopLagIndicator } from './event-loop-lag.indicator.js'
import { ReadinessIndicators } from './readiness-indicators.service.js'
import { SkipTenantResolution } from '../guards/tenant-scope.guard.js'

interface LivenessResponse {
  readonly data: { readonly status: 'ok' }
}

/**
 * SRS-NFR-037 (DTJ-001, шаг 6): `/health` — liveness (процесс жив, без БД/Redis), `/ready` —
 * readiness (Postgres + Redis). Оба помечены `@Public()` (не требуют JWT) И
 * `@SkipTenantResolution()` — проба живучести обязана отвечать даже на пустой `tenants`,
 * иначе healthcheck контейнера не отличит упавшее приложение от незаполненных справочников
 * (см. JSDoc маркера в `tenant-scope.guard.ts`). Это ЕДИНСТВЕННОЕ место применения маркера.
 *
 * Тело `/health` зафиксировано критерием приёмки тикета как `{ data: { status: 'ok' } }`
 * (общий конверт успешного ответа, SRS-API-014). Тело `/ready` намеренно НЕ приводится к
 * тому же конверту — критерий приёмки требует явной детализации по каждой зависимости
 * (`postgres`/`redis` по отдельности), что «из коробки» даёт `HealthCheckResult` Terminus
 * (`details.<key>.status`); обёртка `/ready` в единый `{ data }`/`{ error }` формат
 * транспортного уровня — за глобальным `TransportExceptionFilter`, который заводит другой
 * тикет (см. `assumptions` DTJ-001).
 */
@Controller()
export class HealthController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001.
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(EventLoopLagIndicator) private readonly eventLoopLag: EventLoopLagIndicator,
    @Inject(ReadinessIndicators) private readonly readiness: ReadinessIndicators,
  ) {}

  @Public()
  @SkipTenantResolution()
  @Get('health')
  async checkLiveness(): Promise<LivenessResponse> {
    await this.health.check([() => this.eventLoopLag.check()])
    return { data: { status: 'ok' } }
  }

  @Public()
  @SkipTenantResolution()
  @Get('ready')
  checkReadiness(): Promise<HealthCheckResult> {
    return this.health.check(this.readiness.list())
  }
}
