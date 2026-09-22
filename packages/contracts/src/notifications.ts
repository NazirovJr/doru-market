/**
 * Публичные контракты модуля `notifications` (EP-16, DTJ-372) — DTO presentation-слоя
 * (`notifications-feed.controller.ts`).
 */
import { z } from 'zod'

/** 1:1 с enum `notification_status`. */
export const NOTIFICATION_STATUS_VALUES = ['queued', 'sent', 'delivered', 'failed', 'suppressed_rate_limit'] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUS_VALUES)[number]

/** Состав каналов доставки: `NotificationChannel` из `notify-provider.port.ts` */
export const NOTIFICATION_CHANNEL_VALUES = ['telegram', 'sms', 'web_push', 'in_app'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_VALUES)[number]

/**
 * `NotificationSummarySchema` (DTJ-372) — Zod-схема плоской проекции уведомления для API-ответа.
 * 1:1 с `NotificationRecord` (application-порт), но даты — ISO `string` (транспортный формат,
 * не `Date`), курсор пагинации выносится в `meta.pagination`.
 */
export const NotificationSummarySchema = z.object({
  id: z.string(),
  eventType: z.string().nullable(),
  channel: z.enum(NOTIFICATION_CHANNEL_VALUES),
  status: z.enum(NOTIFICATION_STATUS_VALUES),
  payload: z.object({
    subject: z.string().optional(),
    body: z.string(),
  }),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
})

export type NotificationSummary = z.infer<typeof NotificationSummarySchema>
