/**
 * `notification-event-matrix.ts` (DTJ-370, SRS-ADM-052) — тонкая обёртка над ЕДИНСТВЕННЫМ
 * источником матрицы `NOTIFICATION_EVENT_MATRIX` (`packages/contracts/src/notifications.ts`).
 *
 * Данные вынесены в `@dorutj/contracts`, НЕ определены здесь напрямую: `OutboxToNotificationsConsumer`
 * (`apps/worker`) читает ту же матрицу, чтобы знать, на какие `event_type` подписываться и как
 * резолвить получателей по `recipientRoles` — apps/worker не может импортировать apps/api
 * (depcruise, отдельные TS-проекты), поэтому источник — общий пакет, тот же приём, что
 * `sensitive-fields.ts` (DTJ-375). Этот файл — точка входа СО СТОРОНЫ `apps/api`, читаемая
 * `tests/arch/notification-templates-completeness.spec.ts` (DTJ-369) взамен независимого
 * литерала, устраняя риск рассинхронизации (DTJ-369 «Риски»).
 */
import {
  NOTIFICATION_EVENT_MATRIX,
  type NotificationChannel,
  type NotificationEventMatrixEntry,
} from '@dorutj/contracts'

export { NOTIFICATION_EVENT_MATRIX, type NotificationEventMatrixEntry }

const IN_APP_CHANNEL: NotificationChannel = 'in_app'

/** `undefined` — событие вне матрицы (consumer его игнорирует, не диспетчеризует). */
export function findMatrixEntry(eventType: string): NotificationEventMatrixEntry | undefined {
  return NOTIFICATION_EVENT_MATRIX.find((entry) => entry.eventType === eventType)
}

/**
 * Внешние каналы В ПОРЯДКЕ приоритета фолбэка, БЕЗ `in_app` (гарантированный минимум,
 * диспетчеризуется синхронно отдельно, `DispatchNotificationUseCase`, не участвует в фолбэк-цепочке
 * BullMQ-джобов).
 */
export function resolveExternalChannels(entry: NotificationEventMatrixEntry): readonly NotificationChannel[] {
  return entry.channels.filter((channel) => channel !== IN_APP_CHANNEL)
}
