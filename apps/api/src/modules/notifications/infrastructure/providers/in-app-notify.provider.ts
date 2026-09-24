/**
 * `InAppNotifyProvider` (DTJ-368, EP-16) — тривиальный канал `in_app`: синхронная запись строки в
 * `notifications` (через `NotificationsRepositoryPort`, порт этого тикета, реализация —
 * `DTJ-369`/`DTJ-370`) с `channel='in_app'`, `status='sent'` НЕМЕДЛЕННО (критерий приёмки 3
 * DTJ-368) — in-app не имеет понятия «доставка» отдельно от записи: как только строка создана,
 * считается доставленной, БЕЗ прохождения через BullMQ-очередь `notification-dispatch` для самой
 * доставки (очередь остаётся только для оркестрации остальных каналов, `DTJ-370`).
 *
 * `tenantId` — резолвится через `IdentityFacadePort` (та же зависимость, что `TelegramNotifyProvider`)
 * ПО userId: `NotifyProviderPort.send()` не несёт `tenantId` параметром, а `notifications.tenant_id`
 * — `NOT NULL`. Пользователь не найден → `{ success: false }`, без попытки записи с фиктивным
 * `tenantId`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort } from '@/modules/notifications/application/ports/identity-facade.port.js'
import {
  NOTIFICATIONS_REPOSITORY_PORT,
  type NotificationsRepositoryPort,
} from '@/modules/notifications/application/ports/notifications-repository.port.js'
import {
  type NotifyProviderPort,
  type NotifySendMessage,
  type NotifySendResult,
} from '@/modules/notifications/application/ports/notify-provider.port.js'

@Injectable()
export class InAppNotifyProvider implements NotifyProviderPort {
  private readonly logger = new Logger(InAppNotifyProvider.name)

  public constructor(
    @Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort,
    @Inject(NOTIFICATIONS_REPOSITORY_PORT) private readonly notificationsRepository: NotificationsRepositoryPort,
  ) {}

  public async send(message: NotifySendMessage): Promise<NotifySendResult> {
    const profile = await this.identityFacade.getRecipientProfile(message.userId)
    if (profile === null) {
      this.logger.warn(`in-app-notify: пользователь userId=${message.userId} не найден — запись не создана.`)
      return { success: false }
    }

    const record = await this.notificationsRepository.create({
      userId: message.userId,
      tenantId: profile.tenantId,
      channel: message.channel,
      status: 'sent',
      payload: message.subject === undefined ? { body: message.body } : { subject: message.subject, body: message.body },
      eventType: message.eventType,
      sourceEventId: message.sourceEventId,
    })

    return { success: true, providerMessageId: record.id }
  }
}
