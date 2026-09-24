/**
 * `enqueueNotificationDispatchJob` (DTJ-370) — единая точка постановки job'а на `notification-dispatch`
 * СО СТОРОНЫ apps/worker (используется и `OutboxToNotificationsConsumer` — первый внешний канал, и
 * `NotificationDispatchProcessor` — каскад на следующий канал при исчерпании ретраев текущего),
 * чтобы retry/backoff-политика (SRS-ADM-060) не расходилась между двумя местами постановки.
 */
import type { Queue } from 'bullmq'
import {
  NOTIFICATION_DISPATCH_BACKOFF_TYPE,
  NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
  type NotificationDispatchJobData,
} from '@dorutj/contracts'

/** Имя job'а BullMQ = `jobData.channel` — не отдельный параметр (одно и то же значение, C5 `max-params` ≤3). */
export async function enqueueNotificationDispatchJob(
  queue: Queue<NotificationDispatchJobData>,
  jobData: NotificationDispatchJobData,
  jobId: string,
): Promise<void> {
  await queue.add(jobData.channel, jobData, {
    jobId,
    attempts: NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
    backoff: { type: NOTIFICATION_DISPATCH_BACKOFF_TYPE },
  })
}
