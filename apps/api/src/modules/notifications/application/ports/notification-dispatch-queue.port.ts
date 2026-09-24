/**
 * `NotificationDispatchQueuePort` (DTJ-370, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3) — узкий порт
 * постановки job'а на BullMQ-очередь `notification-dispatch`, потребляемую
 * `apps/worker/src/jobs/notifications/notification-dispatch.processor.ts`. Тот же приём, что
 * `InventorySyncQueuePort`/`BullmqInventorySyncQueueAdapter` (EP-05, DTJ-153): `application`
 * (`DispatchNotificationUseCase`) объявляет и вызывает порт, `infrastructure`
 * (`BullmqNotificationDispatchQueueAdapter`) — единственное место, знающее о `bullmq` (retry/backoff
 * — SRS-ADM-060, задаются АДАПТЕРОМ при постановке, не вызывающим кодом).
 */
import type { NotificationDispatchJobData } from '@dorutj/contracts'
import type { NotificationChannel } from './notify-provider.port.js'

export const NOTIFICATION_DISPATCH_QUEUE_PORT = Symbol.for('@dorutj/notifications/notification-dispatch-queue-port')

export interface NotificationDispatchQueuePort {
  /** `jobId` — `notificationId` (defense-in-depth дедупликация BullMQ поверх UNIQUE(notifications)). */
  enqueue(channel: NotificationChannel, jobData: NotificationDispatchJobData, jobId: string): Promise<void>
}
