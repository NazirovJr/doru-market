/** Публичные контракты `notifications`: DTO апи-ленты + общие для apps/api/apps/worker типы диспетчеризации. */
import { z } from 'zod'
import { USER_ROLES, type UserRole } from './permissions.js'

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

/** Единственный источник матрицы событие×роль×канал (SRS-ADM-052); `channels` — порядок фолбэка, `in_app` всегда последним. */
export interface NotificationEventMatrixEntry {
  readonly eventType: string
  readonly recipientRoles: readonly UserRole[]
  readonly channels: readonly NotificationChannel[]
}

export const NOTIFICATION_EVENT_MATRIX: readonly NotificationEventMatrixEntry[] = [
  { eventType: 'order.paid', recipientRoles: ['customer'], channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'order.processing_started', recipientRoles: ['customer'], channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'order.courier_assigned', recipientRoles: ['customer', 'courier'], channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'order.delivered', recipientRoles: ['customer'], channels: ['telegram', 'sms', 'in_app'] },
  { eventType: 'order.cancelled', recipientRoles: ['customer'], channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'order.refunded', recipientRoles: ['customer'], channels: ['telegram', 'sms', 'in_app'] },
  { eventType: 'payout.status_changed', recipientRoles: ['pharmacy_admin'], channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'prescription.needs_clarification', recipientRoles: ['customer'], channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'prescription.decision', recipientRoles: ['customer'], channels: ['telegram', 'in_app'] },
  { eventType: 'inventory.sync_errors', recipientRoles: ['pharmacy_admin'], channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'moderation.queue_digest', recipientRoles: ['pharmacy_admin'], channels: ['telegram', 'in_app'] },
  { eventType: 'onboarding.license_expiring', recipientRoles: ['pharmacy_admin'], channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'onboarding.suspended', recipientRoles: ['pharmacy_admin'], channels: ['telegram', 'sms', 'in_app'] },
  { eventType: 'ops.sla_breached', recipientRoles: ['support_agent', 'super_admin'], channels: ['web_push', 'in_app'] },
  { eventType: 'billing.invoice_overdue', recipientRoles: ['pharmacy_admin'], channels: ['telegram', 'sms', 'in_app'] },
]

export function isKnownUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value)
}

/** Retry-backoff SRS-ADM-060: 2с/8с/32с — не геометрическая прогрессия, поэтому custom `backoffStrategy`. */
const NOTIFICATION_DISPATCH_BACKOFF_1ST_MS = 2_000
const NOTIFICATION_DISPATCH_BACKOFF_2ND_MS = 8_000
const NOTIFICATION_DISPATCH_BACKOFF_3RD_MS = 32_000

export const NOTIFICATION_DISPATCH_BACKOFF_MS = [
  NOTIFICATION_DISPATCH_BACKOFF_1ST_MS,
  NOTIFICATION_DISPATCH_BACKOFF_2ND_MS,
  NOTIFICATION_DISPATCH_BACKOFF_3RD_MS,
] as const
export const NOTIFICATION_DISPATCH_BACKOFF_TYPE = 'notification-dispatch-backoff'
export const NOTIFICATION_DISPATCH_MAX_ATTEMPTS = NOTIFICATION_DISPATCH_BACKOFF_MS.length

const FIRST_ATTEMPT = 1

/** `attemptsMade` — 1-based (BullMQ: значение ПОСЛЕ проваленной попытки). Вне диапазона — последний элемент. */
export function resolveNotificationDispatchBackoffMs(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade, FIRST_ATTEMPT), NOTIFICATION_DISPATCH_BACKOFF_MS.length) - FIRST_ATTEMPT
  return NOTIFICATION_DISPATCH_BACKOFF_MS[index] ?? NOTIFICATION_DISPATCH_BACKOFF_3RD_MS
}

/** Payload джобы `notification-dispatch`; `remainingChannels` — фолбэк-цепочка после текущего канала (без `in_app`). */
export interface NotificationDispatchJobData {
  readonly notificationId: string
  readonly userId: string
  readonly tenantId: string
  readonly channel: NotificationChannel
  readonly eventType: string
  readonly sourceEventId: string
  readonly remainingChannels: readonly NotificationChannel[]
  readonly templateVariables: Readonly<Record<string, string>>
}

/** Подстановка `{{var}}` — простой `String.replace`, не шаблонизатор (SRS-ADM-054). */
const TEMPLATE_PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g

export function renderTemplateString(text: string, variables: Readonly<Record<string, string>>): string {
  return text.replace(TEMPLATE_PLACEHOLDER_PATTERN, (match, name: string) => variables[name] ?? match)
}

/** Проверка `variablesSchema.required` ДО рендера (SRS-ADM-054) — отсутствие ловится явно, не подстановкой пустоты. */
export function findMissingTemplateVariables(
  required: readonly string[],
  variables: Readonly<Record<string, string>>,
): readonly string[] {
  return required.filter((name) => variables[name] === undefined)
}

/** Имена плейсхолдеров, реально встречающихся в тексте (может отличаться от `variablesSchema.required`). */
export function extractTemplatePlaceholders(text: string): readonly string[] {
  return [...text.matchAll(TEMPLATE_PLACEHOLDER_PATTERN)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
}
