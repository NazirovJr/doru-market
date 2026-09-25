// Producer очереди, consumer — apps/worker. Образец — DeliveryOfferTimeoutProcessor.
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { Queue, type JobsOptions } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  COURIER_DEPART_SLA_WATCHDOG_QUEUE,
  type CourierDepartSlaWatchdogQueuePort,
  type ScheduleCourierDepartSlaWatchdogInput,
} from '@/modules/delivery/application/ports/courier-depart-sla-watchdog-queue.port.js'

export const COURIER_DEPART_SLA_WATCHDOG_QUEUE_NAME = 'courier-depart-sla-watchdog' // своя копия строки в apps/worker, синхронизируется вручную

const MS_PER_MINUTE = 60_000
const JOB_ATTEMPTS = 5
const JOB_BACKOFF_DELAY_MS = 5_000
const REMOVE_ON_COMPLETE_AGE_SECONDS = 86_400
const REMOVE_ON_COMPLETE_COUNT = 10_000
const REMOVE_ON_FAIL_AGE_SECONDS = 604_800

export interface CourierDepartSlaWatchdogJobData {
  readonly deliveryAssignmentId: string
}

const JOB_OPTIONS: Omit<JobsOptions, 'delay' | 'jobId'> = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
  removeOnComplete: { age: REMOVE_ON_COMPLETE_AGE_SECONDS, count: REMOVE_ON_COMPLETE_COUNT },
  removeOnFail: { age: REMOVE_ON_FAIL_AGE_SECONDS },
}

@Injectable()
export class CourierDepartSlaWatchdogProcessor implements CourierDepartSlaWatchdogQueuePort, OnModuleDestroy {
  private readonly queue: Queue<CourierDepartSlaWatchdogJobData>

  public constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<CourierDepartSlaWatchdogJobData>(COURIER_DEPART_SLA_WATCHDOG_QUEUE_NAME, { connection: redis })
  }

  public async schedule(input: ScheduleCourierDepartSlaWatchdogInput): Promise<void> {
    await this.queue.add(
      COURIER_DEPART_SLA_WATCHDOG_QUEUE_NAME,
      { deliveryAssignmentId: input.deliveryAssignmentId },
      { ...JOB_OPTIONS, jobId: input.deliveryAssignmentId, delay: input.delayMinutes * MS_PER_MINUTE },
    )
  }

  public async cancel(deliveryAssignmentId: string): Promise<void> {
    const job = await this.queue.getJob(deliveryAssignmentId)
    if (job !== undefined) {
      await job.remove()
    }
  }

  public async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

export const COURIER_DEPART_SLA_WATCHDOG_QUEUE_PROVIDER = {
  provide: COURIER_DEPART_SLA_WATCHDOG_QUEUE,
  useClass: CourierDepartSlaWatchdogProcessor,
} as const
