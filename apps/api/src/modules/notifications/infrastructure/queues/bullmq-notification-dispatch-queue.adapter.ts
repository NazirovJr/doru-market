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
import type { NotificationChannel } from '@/modules/notifications/application/ports/notify-provider.port.js'
import type { NotificationDispatchQueuePort } from '@/modules/notifications/application/ports/notification-dispatch-queue.port.js'

export const NOTIFICATION_DISPATCH_QUEUE_NAME = 'notification-dispatch'

@Injectable()
export class BullmqNotificationDispatchQueueAdapter implements NotificationDispatchQueuePort, OnModuleDestroy {
  private readonly queue: Queue<NotificationDispatchJobData>

  public constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<NotificationDispatchJobData>(NOTIFICATION_DISPATCH_QUEUE_NAME, { connection: redis })
  }

  public async enqueue(channel: NotificationChannel, jobData: NotificationDispatchJobData, jobId: string): Promise<void> {
    await this.queue.add(channel, jobData, {
      jobId,
      attempts: NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
      backoff: { type: NOTIFICATION_DISPATCH_BACKOFF_TYPE },
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}
