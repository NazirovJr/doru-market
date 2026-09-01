/**
 * Планировщик `prune-search-query-log` (DTJ-181). Регистрирует BullMQ `repeat` job по
 * cron `30 4 * * *` Asia/Dushanbe. Зеркало `outbox-relay.scheduler.ts`/
 * `license-expiry-check.scheduler.ts` — `onModuleInit` не блокирует граф DI (не `async`),
 * иначе недоступный при старте Redis блокирует весь `NestFactory.createApplicationContext`
 * вместе с `GET /health`.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts). Относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  PRUNE_SEARCH_QUERY_LOG_CRON,
  PRUNE_SEARCH_QUERY_LOG_JOB_NAME,
  PRUNE_SEARCH_QUERY_LOG_QUEUE_TOKEN,
  PRUNE_SEARCH_QUERY_LOG_SCHEDULER_ID,
  PRUNE_SEARCH_QUERY_LOG_TZ,
} from './prune-search-query-log.constants.js'
import { PruneSearchQueryLogProcessor } from './prune-search-query-log.processor.js'

@Injectable()
export class PruneSearchQueryLogScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PruneSearchQueryLogScheduler.name)
  private worker: Worker | undefined

  constructor(
    @Inject(PRUNE_SEARCH_QUERY_LOG_QUEUE_TOKEN) private readonly pruneQueue: Queue,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly processor: PruneSearchQueryLogProcessor,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(this.pruneQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`prune-search-query-log: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.pruneQueue.upsertJobScheduler(
      PRUNE_SEARCH_QUERY_LOG_SCHEDULER_ID,
      { pattern: PRUNE_SEARCH_QUERY_LOG_CRON, tz: PRUNE_SEARCH_QUERY_LOG_TZ },
      { name: PRUNE_SEARCH_QUERY_LOG_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.processor.runOnce()
  }
}
