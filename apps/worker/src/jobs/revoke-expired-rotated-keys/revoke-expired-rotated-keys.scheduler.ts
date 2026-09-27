import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
import {
  REVOKE_EXPIRED_ROTATED_KEYS_CRON,
  REVOKE_EXPIRED_ROTATED_KEYS_JOB_NAME,
  REVOKE_EXPIRED_ROTATED_KEYS_QUEUE_TOKEN,
  REVOKE_EXPIRED_ROTATED_KEYS_SCHEDULER_ID,
  REVOKE_EXPIRED_ROTATED_KEYS_TZ,
} from './revoke-expired-rotated-keys.constants.js'
import { RevokeExpiredRotatedKeysJob } from './revoke-expired-rotated-keys.job.js'

/** Агрегирует Queue + cron в один параметр — иначе конструктор нёс бы 4 (max-params ≤3, C5). */
@Injectable()
export class RevokeExpiredRotatedKeysScheduleConfig {
  constructor(
    @Inject(REVOKE_EXPIRED_ROTATED_KEYS_QUEUE_TOKEN) public readonly queue: Queue,
    @Inject(REVOKE_EXPIRED_ROTATED_KEYS_CRON) public readonly cron: string,
  ) {}
}

@Injectable()
export class RevokeExpiredRotatedKeysScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RevokeExpiredRotatedKeysScheduler.name)
  private readonly queue: Queue
  private worker: Worker | undefined

  constructor(
    private readonly schedule: RevokeExpiredRotatedKeysScheduleConfig,
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    private readonly job: RevokeExpiredRotatedKeysJob,
  ) {
    this.queue = schedule.queue
  }

  onModuleInit(): void {
    this.worker = new Worker(this.queue.name, () => this.handleTick(), { connection: this.connection })
    this.scheduleTick().catch((error: unknown) => {
      this.logger.error(`revoke-expired-rotated-keys: не удалось зарегистрировать расписание — ${String(error)}`)
    })
  }

  private async scheduleTick(): Promise<void> {
    await this.queue.upsertJobScheduler(
      REVOKE_EXPIRED_ROTATED_KEYS_SCHEDULER_ID,
      { pattern: this.schedule.cron, tz: REVOKE_EXPIRED_ROTATED_KEYS_TZ },
      { name: REVOKE_EXPIRED_ROTATED_KEYS_JOB_NAME },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  private async handleTick(): Promise<void> {
    await this.job.runOnce()
  }
}
