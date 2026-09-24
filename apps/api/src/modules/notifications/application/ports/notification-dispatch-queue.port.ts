/** Узкий порт постановки job'а на очередь `notification-dispatch` — application не знает о bullmq. */
import type { NotificationDispatchJobData } from '@dorutj/contracts'
import type { NotificationChannel } from './notify-provider.port.js'

export const NOTIFICATION_DISPATCH_QUEUE_PORT = Symbol.for('@dorutj/notifications/notification-dispatch-queue-port')

export interface EnqueueNotificationDispatchInput {
  readonly channel: NotificationChannel
  readonly jobData: NotificationDispatchJobData
  readonly jobId: string
  // Тихие часы: откладывает job до их конца, не отбрасывает; undefined — немедленно.
  readonly delayMs?: number
}

export interface NotificationDispatchQueuePort {
  enqueue(input: EnqueueNotificationDispatchInput): Promise<void>
}
