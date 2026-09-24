/**
 * `BullmqNotificationDispatchQueueAdapter` (DTJ-370) — реализация `NotificationDispatchQueuePort`.
 * Тот же приём, что `BullmqInventorySyncQueueAdapter` (EP-05, DTJ-153): собственная `Queue`,
 * переиспользует общий `REDIS_CLIENT` (DTJ-053), не создаёт параллельного пула, закрывается
 * при остановке модуля.
 *
 * Имя очереди — `NOTIFICATION_DISPATCH_QUEUE_NAME`, СВОЯ копия строки
 * `apps/worker/src/queues/queue.constants.ts` (`QUEUE_NAMES.NOTIFICATION_DISPATCH`) — apps/api не
 * может импортировать apps/worker, отдельные TS-проекты монорепо (тот же приём, что
 * `MOCK_BANK_AUTO_PAY_QUEUE_NAME`, `payments/infrastructure/adapters/mock-bank.provider.ts`).
 *
 * Retry (SRS-ADM-060): 3 попытки, custom backoff `NOTIFICATION_DISPATCH_BACKOFF_TYPE`
 * (2с/8с/32с — не геометрическая прогрессия, поэтому не `{type:'exponential'}`, см. JSDoc
 * `@dorutj/contracts` `resolveNotificationDispatchBackoffMs`) — стратегия РЕГИСТРИРУЕТСЯ на
 * стороне `apps/worker` (`Worker.settings.backoffStrategy`, `notification-dispatch.module.ts`).
 */
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

/** СВОЯ копия `apps/worker/src/queues/queue.constants.ts` `QUEUE_NAMES.NOTIFICATION_DISPATCH`. */
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
