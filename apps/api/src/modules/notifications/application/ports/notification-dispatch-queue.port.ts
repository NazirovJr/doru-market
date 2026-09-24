/** Узкий порт постановки job'а на очередь `notification-dispatch` — application не знает о bullmq. */
import type { NotificationDispatchJobData } from '@dorutj/contracts'
import type { NotificationChannel } from './notify-provider.port.js'

export const NOTIFICATION_DISPATCH_QUEUE_PORT = Symbol.for('@dorutj/notifications/notification-dispatch-queue-port')

export interface NotificationDispatchQueuePort {
  /** `jobId` — `notificationId` (defense-in-depth дедупликация BullMQ поверх UNIQUE(notifications)). */
  enqueue(channel: NotificationChannel, jobData: NotificationDispatchJobData, jobId: string): Promise<void>
}
