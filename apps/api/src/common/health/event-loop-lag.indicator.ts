import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus'

const EVENT_LOOP_HISTOGRAM_RESOLUTION_MS = 20
/** ASSUMPTION (DTJ-001): SRS-NFR-037 требует индикатор лага event loop, но не фиксирует
 * числовой порог — принят как разумный дефолт для процесса, обслуживающего HTTP. */
const EVENT_LOOP_LAG_THRESHOLD_MS = 1000
const NANOSECONDS_PER_MILLISECOND = 1_000_000
const PROCESS_HEALTH_KEY = 'process'

/** Чистая функция решения — вынесена отдельно ради юнит-тестируемости без реального event loop. */
export function isEventLoopLagHealthy(lagMs: number): boolean {
  return Number.isFinite(lagMs) && lagMs < EVENT_LOOP_LAG_THRESHOLD_MS
}

/**
 * `GET /health` — process-индикатор БЕЗ БД/Redis (SRS-NFR-037, DTJ-001 шаг 6): лаг event
 * loop ниже порога. `monitorEventLoopDelay` — встроенный API Node, без внешней зависимости.
 */
@Injectable()
export class EventLoopLagIndicator implements OnModuleInit, OnModuleDestroy {
  private readonly histogram: IntervalHistogram = monitorEventLoopDelay({
    resolution: EVENT_LOOP_HISTOGRAM_RESOLUTION_MS,
  })

  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes`, автовывод токена по типу
  // параметра отказывает в тестах без него — не косметика, см. общий комментарий в DTJ-001.
  constructor(
    @Inject(HealthIndicatorService) private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  onModuleInit(): void {
    this.histogram.enable()
  }

  onModuleDestroy(): void {
    this.histogram.disable()
  }

  check(): HealthIndicatorResult {
    const lagMs = this.currentLagMs()
    const indicator = this.healthIndicatorService.check(PROCESS_HEALTH_KEY)
    return isEventLoopLagHealthy(lagMs)
      ? indicator.up({ eventLoopLagMs: lagMs })
      : indicator.down({ eventLoopLagMs: lagMs })
  }

  /** До накопления первого сэмпла `histogram.mean` — `NaN`; трактуем холодный старт как здоровый. */
  private currentLagMs(): number {
    const meanNanoseconds = this.histogram.mean
    return Number.isFinite(meanNanoseconds) ? meanNanoseconds / NANOSECONDS_PER_MILLISECOND : 0
  }
}
