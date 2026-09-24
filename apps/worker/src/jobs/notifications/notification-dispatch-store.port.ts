/** Узкий порт raw-SQL доступа к notifications/notification_templates/users/tenants со стороны apps/worker (не может импортировать apps/api). */
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
  getUserProfile(userId: string): Promise<WorkerUserProfile | null>
  getBrandName(tenantId: string): Promise<string>
  findTemplate(eventType: string, channel: NotificationChannel, locale: string): Promise<WorkerNotificationTemplate | null>
  /** Идемпотентно по (userId, channel, sourceEventId) — тот же паттерн, что `NotificationsRepository.create` (apps/api). */
  createNotification(input: CreateNotificationRowInput): Promise<CreateNotificationRowResult>
  markNotificationResult(id: string, status: 'sent' | 'failed', failedReason?: string): Promise<void>
}
