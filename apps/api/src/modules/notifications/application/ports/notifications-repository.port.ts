/**
 * `NotificationsRepositoryPort` (DTJ-368, EP-16) — узкий порт персистентности для таблицы
 * `notifications` (`docs/spec/11-database-schema.md` §44: персистентный ЛОГ исходящих уведомлений,
 * читается `apps/admin` для диагностики недоставленных — очередь ИСПОЛНЕНИЯ отдельно, в BullMQ).
 *
 * Порт объявлен ЭТИМ тикетом (нужен `InAppNotifyProvider` ниже), РЕАЛИЗАЦИЯ (реальная
 * Drizzle-схема + миграция таблицы `notifications`, которой на момент этого тикета ещё нет в
 * `apps/api/src/db/schema/`) — `DTJ-369`/`DTJ-370`. До их сдачи `notifications.module.ts`
 * связывает токен с `UnimplementedNotificationsRepositoryAdapter` (бросает на `create()` —
 * тот же приём, что `Unimplemented*FacadeAdapter` в `modules/orders/orders.module.ts`,
 * D-EP09-16: запись без безопасного дефолта обязана падать явно, не молчать).
 *
 * `eventType` НЕОБЯЗАТЕЛЕН — `NotifyProviderPort.send(userId, channel, message)` (DTJ-368) не несёт
 * контекст исходного доменного события (какой outbox-event породил уведомление); этим контекстом
 * владеет диспетчер `DTJ-370` (матрица диспетчеризации, читает `outbox.event_type` до вызова
 * провайдера). `InAppNotifyProvider` этого тикета вызывает `create()` БЕЗ `eventType` — поле
 * заполнится, когда появится вызывающий код с доступом к событию (расширение интерфейса вызывающей
 * стороной, не фиктивное значение здесь).
 */
import { type NotificationChannel } from './notify-provider.port.js'

/** Зеркалит ENUM `notification_status` (`docs/spec/11-database-schema.md` §«Прочее»). */
export type NotificationStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed_rate_limit'

export interface CreateNotificationInput {
  readonly userId: string
  readonly tenantId: string
  readonly channel: NotificationChannel
  readonly status: NotificationStatus
  readonly payload: Record<string, unknown>
  /** См. JSDoc файла §«eventType необязателен». */
  readonly eventType?: string
}

export interface NotificationRecord extends CreateNotificationInput {
  readonly id: string
  readonly sentAt: Date | null
  readonly failedReason: string | null
  readonly createdAt: Date
}

export const NOTIFICATIONS_REPOSITORY_PORT = Symbol.for('@dorutj/notifications/notifications-repository-port')

export interface ListNotificationsCursor {
  readonly v: string
  readonly id: string
}

/**
 * Страничная выборка ленты пользователя:
 * - `userId` — чья лента;
 * - `tenantId` — `null` — актор без тенанта (`super_admin`): фильтр только по `userId`;
 * - `statuses` — не передан — все статусы;
 * - `order` — единственный порядок ленты: новые сверху (`createdAt` по убыванию, при равенстве — `id` по убыванию);
 * - `limit` — число записей на странице;
 * - `cursor` — `{ v: createdAt в ISO, id }` последней записи.
 */
export interface ListNotificationsInput {
  readonly userId: string
  readonly tenantId: string | null
  readonly statuses?: readonly NotificationStatus[] | undefined
  readonly order: 'createdAt:desc'
  readonly limit: number
  readonly cursor: ListNotificationsCursor | null
}

export interface ListNotificationsPage {
  readonly items: readonly NotificationRecord[]
  readonly nextCursor: ListNotificationsCursor | null
  readonly hasMore: boolean
}

export interface NotificationsRepositoryPort {
  create(input: CreateNotificationInput): Promise<NotificationRecord>
  /**
   * Страница ленты пользователя.
   * Сортировка `createdAt` по убыванию, при равенстве — `id` по убыванию.
   * Курсор — `{ v: createdAt в ISO, id }` последней записи.
   * Реализация — DTJ-370.
   */
  list(input: ListNotificationsInput): Promise<ListNotificationsPage>
}
