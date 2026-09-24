/**
 * `NotificationDispatchStorePort` (DTJ-370) — узкий порт доступа к физическим таблицам
 * `notifications`/`notification_templates`/`users`/`tenants`/`processed_events` СО СТОРОНЫ
 * apps/worker. Те же таблицы, что читает/пишет apps/api (`NotificationsRepository`,
 * `NotificationTemplatesRepository`, DTJ-370/369) — ОТДЕЛЬНЫЙ путь доступа (raw SQL, не Drizzle),
 * тот же приём необходимого дублирования через границу процесса, что
 * `PgCashCommissionAggregationAdapter` (DTJ-251, JSDoc §1) — apps/worker не может импортировать
 * apps/api (depcruise, отдельные TS-проекты).
 */
import type { NotificationChannel, NotificationStatus } from '@dorutj/contracts'

export interface WorkerUserProfile {
  readonly tenantId: string
  readonly telegramChatId: bigint | null
  readonly preferredLocale: string
}

export interface WorkerNotificationTemplate {
  readonly subject: string | null
  readonly body: string
  readonly requiredVariables: readonly string[]
}

export interface CreateNotificationRowInput {
  readonly userId: string
  readonly tenantId: string
  readonly channel: NotificationChannel
  readonly status: NotificationStatus
  readonly payload: Record<string, unknown>
  readonly eventType: string
  readonly sourceEventId: string
}

export interface CreateNotificationRowResult {
  readonly id: string
  /** `false` — строка уже существовала (UNIQUE-конфликт, SRS-ADM-057), возвращена существующая. */
  readonly created: boolean
}

export interface NotificationDispatchStorePort {
  /** `true` — вставлено (событие обрабатывается впервые); `false` — уже обработано (SRS-DOM-152). */
  insertProcessedEventIfNew(consumerName: string, eventId: string): Promise<boolean>
  getUserProfile(userId: string): Promise<WorkerUserProfile | null>
  getBrandName(tenantId: string): Promise<string>
  findTemplate(eventType: string, channel: NotificationChannel, locale: string): Promise<WorkerNotificationTemplate | null>
  /** Идемпотентно по (userId, channel, sourceEventId) — тот же паттерн, что `NotificationsRepository.create` (apps/api). */
  createNotification(input: CreateNotificationRowInput): Promise<CreateNotificationRowResult>
  markNotificationResult(id: string, status: 'sent' | 'failed', failedReason?: string): Promise<void>
}
