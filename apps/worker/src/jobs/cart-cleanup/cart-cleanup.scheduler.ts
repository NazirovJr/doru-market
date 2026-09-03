/**
 * Планировщик `cart-cleanup` (DTJ-224). Регистрирует BullMQ `repeat` job по cron `0 5 * * *`
 * Asia/Dushanbe. Зеркало `prune-search-query-log.scheduler.ts`/`license-expiry-check.scheduler.ts`
 * — `onModuleInit` не блокирует граф DI (не `async`), иначе недоступный при старте Redis
 * блокирует весь `NestFactory.createApplicationContext` вместе с `GET /health`.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. common/health/health.service.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. common/health/health.service.ts). Относительный путь до правки nest-cli.json.
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  CART_CLEANUP_CRON,
  CART_CLEANUP_JOB_NAME,
  CART_CLEANUP_QUEUE_TOKEN,
  CART_CLEANUP_SCHEDULER_ID,
  CART_CLEANUP_TZ,
} from './cart-cleanup.constants.js'
import { CartAbandonedCleanupJob } from './cart-abandoned-cleanup.job.js'

@Injectable()
export class CartCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CartCleanupScheduler.name)
  private worker: Worker | undefined

  constructor(
    @Inject(CART_CLEANUP_QUEUE_TOKEN) private readonly cleanupQueue: Queue,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: CartAbandonedCleanupJob,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(this.cleanupQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`cart-cleanup: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.cleanupQueue.upsertJobScheduler(
      CART_CLEANUP_SCHEDULER_ID,
      { pattern: CART_CLEANUP_CRON, tz: CART_CLEANUP_TZ },
      { name: CART_CLEANUP_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
