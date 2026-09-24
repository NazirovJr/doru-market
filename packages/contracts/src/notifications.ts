/**
 * Публичные контракты модуля `notifications` (EP-16, DTJ-372/370) — DTO presentation-слоя
 * (`notifications-feed.controller.ts`) и общие для apps/api + apps/worker типы диспетчеризации
 * (DTJ-370): apps/worker НЕ может импортировать apps/api (depcruise, отдельные TS-проекты монорепо,
 * см. `apps/api/src/modules/payments/infrastructure/adapters/mock-bank.provider.ts` §JSDoc) — общее
 * место, тот же приём, что `sensitive-fields.ts` (DTJ-375).
 */
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

/**
 * `NOTIFICATION_EVENT_MATRIX` (DTJ-370) — ЕДИНСТВЕННЫЙ источник матрицы событие × роль × канал
 * (`SRS-ADM-052`, `docs/spec/27-module-admin-moderation-onboarding.md` §6.1, дословная транскрипция
 * таблицы). Порядок `channels` = порядок приоритета фолбэка (первый — самый приоритетный внешний
 * канал); `in_app` ВСЕГДА последним элементом — гарантированный минимум (SRS-ADM-084), диспетчеризуется
 * синхронно отдельно от остальных (`DispatchNotificationUseCase`), не участвует в фолбэк-цепочке.
 *
 * Переиспользуется:
 * - `apps/api/src/modules/notifications/application/notification-event-matrix.ts` (тонкая обёртка);
 * - `tests/arch/notification-templates-completeness.spec.ts` (DTJ-369, полнота шаблонов);
 * - `apps/worker/src/jobs/notifications/outbox-to-notifications.consumer.ts` (список
 *   `event_type`, на которые подписан consumer, и `recipientRoles` для резолва получателей).
 */
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

/**
 * Ретраи `notification-dispatch` (SRS-ADM-060): 3 попытки, backoff 2с/8с/32с — НЕ чистая
 * геометрическая прогрессия (иначе тип BullMQ `{type:'exponential'}` дал бы 2с/4с/8с), поэтому
 * custom backoff strategy (`WorkerOptions.settings.backoffStrategy`), регистрируемая ОБОИМИ
 * сторонами очереди под одним именем `NOTIFICATION_DISPATCH_BACKOFF_TYPE`: apps/api (producer,
 * `queue.add(..., { backoff: { type: NOTIFICATION_DISPATCH_BACKOFF_TYPE } })`) и apps/worker
 * (consumer, `new Worker(..., { settings: { backoffStrategy: resolveNotificationDispatchBackoffMs } })`).
 */
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

/**
 * Payload джобы `notification-dispatch` (DTJ-370). `remainingChannels` — внешние каналы ПОСЛЕ
 * текущего (без `in_app`, порядок фолбэка); при исчерпании ретраев текущего канала процессор
 * ставит job на `remainingChannels[0]` (если есть) с `remainingChannels.slice(1)`.
 */
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

/** Движок подстановки шаблонов (SRS-ADM-054): простой `String.replace`, не Handlebars — переиспользуется
 * `NotificationTemplate.render` (apps/api) и `apps/worker` (не может импортировать apps/api). */
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
