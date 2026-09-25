// Producer очереди delivery-offer-timeout, consumer — apps/worker (мост — internal HTTP, тот же приём, что PartialFulfillmentTimeoutProcessor).
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { Queue, type JobsOptions } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  DELIVERY_OFFER_TIMEOUT_QUEUE,
  type DeliveryOfferTimeoutQueuePort,
  type ScheduleDeliveryOfferTimeoutInput,
} from '@/modules/delivery/application/ports/delivery-offer-timeout-queue.port.js'

export const DELIVERY_OFFER_TIMEOUT_QUEUE_NAME = 'delivery-offer-timeout' // своя копия строки в apps/worker, синхронизируется вручную

const JOB_ATTEMPTS = 5
const JOB_BACKOFF_DELAY_MS = 5_000
const REMOVE_ON_COMPLETE_AGE_SECONDS = 86_400
const REMOVE_ON_COMPLETE_COUNT = 10_000
const REMOVE_ON_FAIL_AGE_SECONDS = 604_800

export interface DeliveryOfferTimeoutJobData {
  readonly offerId: string
}

const JOB_OPTIONS: Omit<JobsOptions, 'delay' | 'jobId'> = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
  removeOnComplete: { age: REMOVE_ON_COMPLETE_AGE_SECONDS, count: REMOVE_ON_COMPLETE_COUNT },
  removeOnFail: { age: REMOVE_ON_FAIL_AGE_SECONDS },
}

@Injectable()
export class DeliveryOfferTimeoutProcessor implements DeliveryOfferTimeoutQueuePort, OnModuleDestroy {
  private readonly queue: Queue<DeliveryOfferTimeoutJobData>

  public constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<DeliveryOfferTimeoutJobData>(DELIVERY_OFFER_TIMEOUT_QUEUE_NAME, { connection: redis })
  }

  public async schedule(input: ScheduleDeliveryOfferTimeoutInput): Promise<void> {
    await this.queue.add(
      DELIVERY_OFFER_TIMEOUT_QUEUE_NAME,
      { offerId: input.offerId },
      { ...JOB_OPTIONS, jobId: input.offerId, delay: input.delaySeconds * 1000 },
    )
  }

  public async cancel(offerId: string): Promise<void> {
    const job = await this.queue.getJob(offerId)
    if (job !== undefined) {
      await job.remove()
    }
  }

  public async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

export const DELIVERY_OFFER_TIMEOUT_QUEUE_PROVIDER = {
  provide: DELIVERY_OFFER_TIMEOUT_QUEUE,
  useClass: DeliveryOfferTimeoutProcessor,
} as const
