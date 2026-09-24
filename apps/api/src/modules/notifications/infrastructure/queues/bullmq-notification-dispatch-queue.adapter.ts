/** Имя очереди — копия apps/worker `QUEUE_NAMES.NOTIFICATION_DISPATCH` (apps/api не может импортировать apps/worker). */
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import {
  NOTIFICATION_DISPATCH_BACKOFF_TYPE,
  NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
  type NotificationDispatchJobData,
} from '@dorutj/contracts'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import type { EnqueueNotificationDispatchInput, NotificationDispatchQueuePort } from '@/modules/notifications/application/ports/notification-dispatch-queue.port.js'

export const NOTIFICATION_DISPATCH_QUEUE_NAME = 'notification-dispatch'

@Injectable()
export class BullmqNotificationDispatchQueueAdapter implements NotificationDispatchQueuePort, OnModuleDestroy {
  private readonly queue: Queue<NotificationDispatchJobData>

  public constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<NotificationDispatchJobData>(NOTIFICATION_DISPATCH_QUEUE_NAME, { connection: redis })
  }

  public async enqueue(input: EnqueueNotificationDispatchInput): Promise<void> {
    const { channel, jobData, jobId, delayMs } = input
    await this.queue.add(channel, jobData, {
      jobId,
      attempts: NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
      backoff: { type: NOTIFICATION_DISPATCH_BACKOFF_TYPE },
      ...(delayMs !== undefined && delayMs > 0 && { delay: delayMs }),
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}
