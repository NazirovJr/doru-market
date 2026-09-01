/**
 * Планировщик `license-expiry-check` (DTJ-073). Регистрирует BullMQ `repeat`
 * job по cron `0 6 * * *` Asia/Dushanbe. Зеркало `outbox-relay.scheduler.ts`.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// @/ алиас не резолвится в раннтайме (см. outbox-relay.scheduler.ts).
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме: nest-cli.json использует дефолтный tsc-билдер без webpack/tsconfig-paths (см. outbox-relay.scheduler.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  LICENSE_EXPIRY_CHECK_CRON,
  LICENSE_EXPIRY_CHECK_JOB_NAME,
  LICENSE_EXPIRY_CHECK_QUEUE,
  LICENSE_EXPIRY_CHECK_SCHEDULER_ID,
  LICENSE_EXPIRY_CHECK_TZ,
} from './license-expiry-check.constants.js'
import { LicenseExpiryCheckProcessor } from './license-expiry-check.processor.js'

@Injectable()
export class LicenseExpiryCheckScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LicenseExpiryCheckScheduler.name)
  private worker: Worker | undefined

  constructor(
    @Inject(LICENSE_EXPIRY_CHECK_QUEUE) private readonly checkQueue: Queue,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly processor: LicenseExpiryCheckProcessor,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(this.checkQueue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`license-expiry-check: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.checkQueue.upsertJobScheduler(
      LICENSE_EXPIRY_CHECK_SCHEDULER_ID,
      { pattern: LICENSE_EXPIRY_CHECK_CRON, tz: LICENSE_EXPIRY_CHECK_TZ },
      { name: LICENSE_EXPIRY_CHECK_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    const suspended = await this.processor.runOnce()
    this.logger.log(`license-expiry-check: тик выполнен, приостановлено ${String(suspended)} аптек`)
  }
}
