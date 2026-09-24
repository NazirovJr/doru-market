/**
 * `DispatchNotificationUseCase` (DTJ-370, EP-16) — единственная точка, где событие превращается в
 * реальную попытку доставки конкретному пользователю конкретным каналом (SRS-ADM-084/057/060).
 *
 * Порядок (критерий приёмки 3 DTJ-370, проверяется тестом порядка вызовов, не только состояния БД):
 * 1. `in_app` — СИНХРОННО, ПЕРВЫМ, всегда, даже если ВСЕ внешние каналы окажутся недоступны
 *    (рендер шаблона + `NotifyProviderPort` канала `in_app`, который сам пишет строку в
 *    `notifications` и перехватывает `UNIQUE`-конфликт как идемпотентный no-op).
 * 2. Внешние каналы матрицы (без `in_app`) — если есть хотя бы один, создаётся строка
 *    `notifications(status='queued')` для ПЕРВОГО по приоритету фолбэка (идемпотентно по
 *    `sourceEventId`) и ставится ОДНА BullMQ job на `notification-dispatch`; `remainingChannels`
 *    в payload job'а — остальные каналы, к ним переходит ПРОЦЕССОР (`apps/worker`) при
 *    исчерпании ретраев текущего, а не эта команда сразу для всех (см. риски тикета §5/АС2).
 *
 * Рендер `in_app` — здесь (НЕ в процессоре, тот обрабатывает только внешние каналы): шаблон
 * (`NotificationTemplatesRepositoryPort`, локаль — `user.preferredLocale`, риски тикета
 * §«user.locale») + `brandName` тенанта (`SRS-ADM-056`, `TENANT_SETTINGS_REPOSITORY` — публичный
 * фасад `modules/tenancy`, не гостевая правка).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { NotificationDispatchJobData } from '@dorutj/contracts'
import { TENANT_SETTINGS_REPOSITORY, TenantId, type TenantSettingsRepositoryPort } from '@/modules/tenancy/index.js'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort } from '../ports/identity-facade.port.js'
import {
  NOTIFICATIONS_REPOSITORY_PORT,
  type NotificationsRepositoryPort,
} from '../ports/notifications-repository.port.js'
import {
  NOTIFICATION_TEMPLATES_REPOSITORY_PORT,
  type NotificationTemplatesRepositoryPort,
} from '../ports/notification-templates-repository.port.js'
import {
  NOTIFY_PROVIDER_IN_APP,
  type NotificationChannel,
  type NotifyProviderPort,
} from '../ports/notify-provider.port.js'
import {
  NOTIFICATION_DISPATCH_QUEUE_PORT,
  type NotificationDispatchQueuePort,
} from '../ports/notification-dispatch-queue.port.js'
import { NOTIFICATION_TEMPLATE_LOCALES, type NotificationTemplateLocale } from '../../domain/notification-template.entity.js'

const IN_APP_CHANNEL: NotificationChannel = 'in_app'
const DEFAULT_LOCALE: NotificationTemplateLocale = 'ru'

export interface DispatchNotificationCommand {
  readonly userId: string
  readonly eventType: string
  readonly sourceEventId: string
  /** Полный список каналов из `NOTIFICATION_EVENT_MATRIX` (порядок фолбэка), ВКЛЮЧАЯ `in_app`. */
  readonly channels: readonly NotificationChannel[]
  /** Уже сериализованные в `string` переменные для `NotificationTemplate.render()` (без `brandName` — добавляется здесь). */
  readonly templateVariables: Readonly<Record<string, string>>
}

export interface DispatchNotificationResult {
  readonly inAppDelivered: boolean
  readonly queuedChannel: NotificationChannel | null
}

@Injectable()
export class DispatchNotificationUseCase {
  private readonly logger = new Logger(DispatchNotificationUseCase.name)

  // eslint-disable-next-line max-params -- 6 DI-инъекций NestJS constructor injection (тот же приём, что RequestOtpUseCase/TelegramAuthUseCase, apps/api/src/modules/auth).
  public constructor(
    @Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort,
    @Inject(NOTIFICATIONS_REPOSITORY_PORT) private readonly notificationsRepository: NotificationsRepositoryPort,
    @Inject(NOTIFICATION_TEMPLATES_REPOSITORY_PORT) private readonly templatesRepository: NotificationTemplatesRepositoryPort,
    @Inject(NOTIFY_PROVIDER_IN_APP) private readonly inAppProvider: NotifyProviderPort,
    @Inject(TENANT_SETTINGS_REPOSITORY) private readonly tenantSettingsRepository: TenantSettingsRepositoryPort,
    @Inject(NOTIFICATION_DISPATCH_QUEUE_PORT) private readonly dispatchQueue: NotificationDispatchQueuePort,
  ) {}

  public async execute(command: DispatchNotificationCommand): Promise<DispatchNotificationResult> {
    const profile = await this.identityFacade.getRecipientProfile(command.userId)
    if (profile === null) {
      this.logger.warn(`dispatch-notification: userId=${command.userId} не найден — диспетчеризация пропущена.`)
      return { inAppDelivered: false, queuedChannel: null }
    }

    const locale = resolveLocale(profile.preferredLocale)
    const brandName = await this.resolveBrandName(profile.tenantId)
    const variables: Readonly<Record<string, string>> = { ...command.templateVariables, brandName }

    // Шаг 1 (АС3, DoD) — in_app СИНХРОННО и ПЕРВЫМ, независимо от здоровья внешних каналов ниже.
    const inAppResult = await this.dispatchInApp(command, locale, variables)

    // Шаг 2 — внешние каналы: ТОЛЬКО первый по приоритету фолбэка ставится в очередь здесь,
    // остальные — эстафета процессора (см. JSDoc файла).
    const externalChannels = command.channels.filter((channel) => channel !== IN_APP_CHANNEL)
    if (externalChannels.length === 0) {
      return { inAppDelivered: inAppResult.success, queuedChannel: null }
    }

    const [firstChannel, ...remainingChannels] = externalChannels as [NotificationChannel, ...NotificationChannel[]]
    await this.enqueueChannel({ command, tenantId: profile.tenantId, channel: firstChannel, remainingChannels, templateVariables: variables })
    return { inAppDelivered: inAppResult.success, queuedChannel: firstChannel }
  }

  private async dispatchInApp(
    command: DispatchNotificationCommand,
    locale: NotificationTemplateLocale,
    variables: Readonly<Record<string, string>>,
  ): Promise<{ readonly success: boolean }> {
    const template = await this.templatesRepository.findByEventChannelLocale(command.eventType, IN_APP_CHANNEL, locale)
    if (template === null) {
      this.logger.error(
        `dispatch-notification: нет шаблона (eventType=${command.eventType}, channel=in_app, locale=${locale}) — in_app НЕ создан.`,
      )
      return { success: false }
    }
    const rendered = template.render(variables)
    const result = await this.inAppProvider.send(command.userId, IN_APP_CHANNEL, rendered, {
      eventType: command.eventType,
      sourceEventId: command.sourceEventId,
    })
    return { success: result.success }
  }

  /** Объект-параметр (C5, `max-params` ≤3) — 5 логически неразделимых полей одной постановки job'а. */
  private async enqueueChannel(input: {
    readonly command: DispatchNotificationCommand
    readonly tenantId: string
    readonly channel: NotificationChannel
    readonly remainingChannels: readonly NotificationChannel[]
    readonly templateVariables: Readonly<Record<string, string>>
  }): Promise<void> {
    const { command, tenantId, channel, remainingChannels, templateVariables } = input
    const record = await this.notificationsRepository.create({
      userId: command.userId,
      tenantId,
      channel,
      status: 'queued',
      payload: templateVariables,
      eventType: command.eventType,
      sourceEventId: command.sourceEventId,
    })

    const jobData: NotificationDispatchJobData = {
      notificationId: record.id,
      userId: command.userId,
      tenantId,
      channel,
      eventType: command.eventType,
      sourceEventId: command.sourceEventId,
      remainingChannels,
      templateVariables,
    }

    // `jobId = record.id` — defense-in-depth поверх UNIQUE(notifications): повторная постановка
    // (at-least-once outbox) для уже существующей строки не создаёт вторую job (тот же приём,
    // что `BullmqInventorySyncQueueAdapter`/`MockBankProvider.enqueueWebhookJob`). Retry/backoff —
    // внутри адаптера (`BullmqNotificationDispatchQueueAdapter`), не здесь (application не знает о bullmq).
    await this.dispatchQueue.enqueue(channel, jobData, record.id)
  }

  private async resolveBrandName(tenantId: string): Promise<string> {
    const settings = await this.tenantSettingsRepository.findByTenantId(TenantId.from(tenantId))
    return settings?.brandName ?? ''
  }
}

function resolveLocale(rawLocale: string): NotificationTemplateLocale {
  return (NOTIFICATION_TEMPLATE_LOCALES as readonly string[]).includes(rawLocale)
    ? (rawLocale as NotificationTemplateLocale)
    : DEFAULT_LOCALE
}
