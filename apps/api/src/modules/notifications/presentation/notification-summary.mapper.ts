/**
 * `notification-summary.mapper.ts` (DTJ-372) — `NotificationRecord` (application-слой) → `NotificationSummary`
 * (`@dorutj/contracts`), DTJ-372 DoD, раздел 0 `02-CleanArchitecture.md` §5.
 */
import type { NotificationSummary } from '@dorutj/contracts'
import type { NotificationRecord } from '../application/ports/notifications-repository.port.js'

export function toNotificationSummary(record: NotificationRecord): NotificationSummary {
  const body = typeof record.payload.body === 'string' ? record.payload.body : ''
  const subject = typeof record.payload.subject === 'string' ? record.payload.subject : undefined
  const payload: { body: string; subject?: string } = { body }
  if (subject !== undefined) {
    payload.subject = subject
  }
  return {
    id: record.id,
    eventType: record.eventType ?? null,
    channel: record.channel,
    status: record.status,
    payload,
    sentAt: record.sentAt === null ? null : record.sentAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  }
}
