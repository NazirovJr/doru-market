/** Ядро диспетчеризации: in_app синхронно первым (SRS-ADM-084), затем первый внешний канал матрицы в очередь. */
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
import {
  NOTIFICATION_PREFERENCES_REPOSITORY_PORT,
  type NotificationPreferencesRepositoryPort,
} from '../ports/notification-preferences-repository.port.js'
import { NOTIFICATION_TEMPLATE_LOCALES, type NotificationTemplateLocale } from '../../domain/notification-template.entity.js'
import { resolveNotificationCategory } from '../notification-event-categories.js'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'

const IN_APP_CHANNEL: NotificationChannel = 'in_app'
const DEFAULT_LOCALE: NotificationTemplateLocale = 'ru'
const DUSHANBE_UTC_OFFSET_HOURS = 5
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const MS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND
const DUSHANBE_UTC_OFFSET_MS = DUSHANBE_UTC_OFFSET_HOURS * MS_PER_HOUR
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR

export interface DispatchNotificationCommand {
  readonly userId: string
  readonly eventType: string
  readonly sourceEventId: string
  /** Каналы из `NOTIFICATION_EVENT_MATRIX`, включая `in_app`. */
  readonly channels: readonly NotificationChannel[]
  /** Без `brandName` — добавляется здесь из tenant_settings. */
  readonly templateVariables: Readonly<Record<string, string>>
}

export interface DispatchNotificationResult {
  readonly inAppDelivered: boolean
  readonly queuedChannel: NotificationChannel | null
}

@Injectable()
export class DispatchNotificationUseCase {
  private readonly logger = new Logger(DispatchNotificationUseCase.name)

  // eslint-disable-next-line max-params -- 8 DI-инъекций NestJS constructor injection (тот же приём, что RequestOtpUseCase/TelegramAuthUseCase, apps/api/src/modules/auth).
  public constructor(
    @Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort,
    @Inject(NOTIFICATIONS_REPOSITORY_PORT) private readonly notificationsRepository: NotificationsRepositoryPort,
    @Inject(NOTIFICATION_TEMPLATES_REPOSITORY_PORT) private readonly templatesRepository: NotificationTemplatesRepositoryPort,
    @Inject(NOTIFY_PROVIDER_IN_APP) private readonly inAppProvider: NotifyProviderPort,
    @Inject(TENANT_SETTINGS_REPOSITORY) private readonly tenantSettingsRepository: TenantSettingsRepositoryPort,
    @Inject(NOTIFICATION_DISPATCH_QUEUE_PORT) private readonly dispatchQueue: NotificationDispatchQueuePort,
    @Inject(NOTIFICATION_PREFERENCES_REPOSITORY_PORT) private readonly preferencesRepository: NotificationPreferencesRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
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

    const inAppResult = await this.dispatchInApp(command, locale, variables)

    const rawExternalChannels = command.channels.filter((channel) => channel !== IN_APP_CHANNEL)
    if (rawExternalChannels.length === 0) {
      return { inAppDelivered: inAppResult.success, queuedChannel: null }
    }

    const category = resolveNotificationCategory(command.eventType)
    const externalChannels = await this.filterEnabledChannels(command.userId, category, rawExternalChannels)
    if (externalChannels.length === 0) {
      return { inAppDelivered: inAppResult.success, queuedChannel: null }
    }

    const [firstChannel, ...remainingChannels] = externalChannels as [NotificationChannel, ...NotificationChannel[]]
    const delayMs = await this.resolveQuietHoursDelayMs(command.userId, category, firstChannel)
    await this.enqueueChannel({
      command,
      tenantId: profile.tenantId,
      channel: firstChannel,
      remainingChannels,
      templateVariables: variables,
      ...(delayMs !== undefined && { delayMs }),
    })
    return { inAppDelivered: inAppResult.success, queuedChannel: firstChannel }
  }

  private async filterEnabledChannels(
    userId: string,
    category: string | null,
    channels: readonly NotificationChannel[],
  ): Promise<readonly NotificationChannel[]> {
    if (category === null) {
      return channels
    }
    const decisions = await Promise.all(
      channels.map(async (channel) => {
        const preference = await this.preferencesRepository.findByUserCategoryChannel(userId, category, channel)
        return { channel, isEnabled: preference?.isEnabled ?? true }
      }),
    )
    return decisions.filter((decision) => decision.isEnabled).map((decision) => decision.channel)
  }

  private async resolveQuietHoursDelayMs(userId: string, category: string | null, channel: NotificationChannel): Promise<number | undefined> {
    if (category === null) {
      return undefined
    }
    const preference = await this.preferencesRepository.findByUserCategoryChannel(userId, category, channel)
    if (preference === null) {
      return undefined
    }
    const now = this.clock.now()
    if (!preference.shouldSuppressNow(now) || preference.quietHoursEnd === null) {
      return undefined
    }
    return computeDelayMsUntilDushanbeTime(now, preference.quietHoursEnd)
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
    const result = await this.inAppProvider.send({
      ...rendered,
      userId: command.userId,
      channel: IN_APP_CHANNEL,
      eventType: command.eventType,
      sourceEventId: command.sourceEventId,
    })
    return { success: result.success }
  }

  /** Объект-параметр (C5, `max-params` ≤3) — логически неразделимые поля одной постановки job'а. */
  private async enqueueChannel(input: {
    readonly command: DispatchNotificationCommand
    readonly tenantId: string
    readonly channel: NotificationChannel
    readonly remainingChannels: readonly NotificationChannel[]
    readonly templateVariables: Readonly<Record<string, string>>
    readonly delayMs?: number
  }): Promise<void> {
    const { command, tenantId, channel, remainingChannels, templateVariables, delayMs } = input
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

    // jobId = record.id — дедупликация поверх UNIQUE(notifications) при at-least-once outbox.
    // exactOptionalPropertyTypes: не присваивать delayMs явным undefined — либо есть, либо ключа нет.
    await this.dispatchQueue.enqueue({ channel, jobData, jobId: record.id, ...(delayMs !== undefined && { delayMs }) })
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

// Ближайший момент wallTime (Asia/Dushanbe), не раньше now.
function computeDelayMsUntilDushanbeTime(now: Date, wallTime: string): number {
  const match = /^(\d{2}):(\d{2})/.exec(wallTime)
  const hours = match === null ? 0 : Number(match[1])
  const minutes = match === null ? 0 : Number(match[2])

  const dushanbeParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dushanbe',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string): number => Number(dushanbeParts.find((p) => p.type === type)?.value ?? '0')

  const naiveUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), hours, minutes, 0)
  const candidateMs = naiveUtcMs - DUSHANBE_UTC_OFFSET_MS
  const targetMs = candidateMs <= now.getTime() ? candidateMs + MS_PER_DAY : candidateMs
  return targetMs - now.getTime()
}
