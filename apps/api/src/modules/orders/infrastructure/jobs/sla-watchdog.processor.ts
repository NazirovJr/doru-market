/** DTJ-307 (EP-12, SRS-PHT-033) — producer очереди `picking-sla-watchdog`, consumer — apps/worker. Образец — `PartialFulfillmentTimeoutProcessor`. */
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { Queue, type JobsOptions } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  SLA_WATCHDOG_QUEUE,
  type ScheduleSlaWatchdogJobsInput,
  type SlaWatchdogQueuePort,
} from '@/modules/orders/application/ports/sla-watchdog-queue.port.js'

/** Своя копия строк есть в apps/worker (`picking-sla-watchdog.types.ts`): отдельные TS-проекты, синхронизируется вручную. */
export const SLA_WATCHDOG_QUEUE_NAME = 'picking-sla-watchdog'
export const SLA_WATCHDOG_JOB_SOFT = 'soft'
export const SLA_WATCHDOG_JOB_HARD = 'hard'

const MS_PER_MINUTE = 60_000
const JOB_ATTEMPTS = 5
const JOB_BACKOFF_DELAY_MS = 5_000
const REMOVE_ON_COMPLETE_AGE_SECONDS = 86_400
const REMOVE_ON_COMPLETE_COUNT = 10_000
const REMOVE_ON_FAIL_AGE_SECONDS = 604_800

export interface SlaWatchdogJobData {
  readonly orderId: string
  readonly tenantId: string
}

const JOB_OPTIONS: Omit<JobsOptions, 'delay' | 'jobId'> = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
  removeOnComplete: { age: REMOVE_ON_COMPLETE_AGE_SECONDS, count: REMOVE_ON_COMPLETE_COUNT },
  removeOnFail: { age: REMOVE_ON_FAIL_AGE_SECONDS },
}

/** Без «:» — BullMQ 6 бросает `Custom Id cannot contain :`. Один заказ — один мягкий и один жёсткий джоб. */
export function slaWatchdogJobId(kind: typeof SLA_WATCHDOG_JOB_SOFT | typeof SLA_WATCHDOG_JOB_HARD, orderId: string): string {
  return `sla-${kind}-${orderId}`
}

@Injectable()
export class SlaWatchdogProcessor implements SlaWatchdogQueuePort, OnModuleDestroy {
  private readonly queue: Queue<SlaWatchdogJobData>

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<SlaWatchdogJobData>(SLA_WATCHDOG_QUEUE_NAME, { connection: redis })
  }

  async schedule(input: ScheduleSlaWatchdogJobsInput): Promise<void> {
    const data: SlaWatchdogJobData = { orderId: input.orderId, tenantId: input.tenantId }
    await this.queue.add(SLA_WATCHDOG_JOB_SOFT, data, {
      ...JOB_OPTIONS,
      jobId: slaWatchdogJobId(SLA_WATCHDOG_JOB_SOFT, input.orderId),
      delay: input.softDelayMinutes * MS_PER_MINUTE,
    })
    await this.queue.add(SLA_WATCHDOG_JOB_HARD, data, {
      ...JOB_OPTIONS,
      jobId: slaWatchdogJobId(SLA_WATCHDOG_JOB_HARD, input.orderId),
      delay: input.hardDelayMinutes * MS_PER_MINUTE,
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

export const SLA_WATCHDOG_QUEUE_PROVIDER = {
  provide: SLA_WATCHDOG_QUEUE,
  useClass: SlaWatchdogProcessor,
} as const