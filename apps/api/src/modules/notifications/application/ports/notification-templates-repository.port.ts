/**
 * `NotificationTemplatesRepositoryPort` (DTJ-369, EP-16) — узкий порт чтения таблицы
 * `notification_templates` (SRS-ADM-054). Только чтение: строки создаются/обновляются ИСКЛЮЧИТЕЛЬНО
 * сидом (`db/seed/notification-templates/`, `pnpm db:seed`), не через API/use case этого тикета —
 * шаблоны не CRUD-сущность для конечного пользователя в R1 (ticket «Что сделать» ограничивает
 * скоуп таблицей + сидом + CI-тестом полноты, без admin-эндпоинта редактирования).
 *
 * `findByEventChannelLocale` — единственный метод, нужный диспетчеру `DTJ-370` (матрица
 * событие × канал × локаль, читает `outbox.event_type` + разрешённый канал, резолвит locale
 * получателя, запрашивает готовую строку для `render()`).
 */
import type {
  NotificationTemplate,
  NotificationTemplateChannel,
  NotificationTemplateLocale,
} from '../../domain/notification-template.entity.js'

export const NOTIFICATION_TEMPLATES_REPOSITORY_PORT = Symbol.for(
  '@dorutj/notifications/notification-templates-repository-port',
)

export interface NotificationTemplatesRepositoryPort {
  findByEventChannelLocale(
    eventType: string,
    channel: NotificationTemplateChannel,
    locale: NotificationTemplateLocale,
  ): Promise<NotificationTemplate | null>
}
