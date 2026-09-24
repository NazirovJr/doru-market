/**
 * `NotificationDispatchProcessor` (DTJ-368 скелет, наполнен DTJ-370) — обрабатывает ОДНУ job'у
 * очереди `notification-dispatch`: один канал, один получатель. `in_app` сюда НИКОГДА не попадает
 * (диспетчеризуется синхронно, `dispatch-to-recipient.ts`/`DispatchNotificationUseCase` — apps/api).
 *
 * Retry (SRS-ADM-060): BullMQ `attempts=3`, backoff — постановщик job'а (`enqueueNotificationDispatchJob`),
 * НЕ этот файл. Given попытка неуспешна И это НЕ последняя попытка, Then БРОСАЕТ — BullMQ сам
 * переставит job с задержкой из `Worker.settings.backoffStrategy` (`notification-dispatch.module.ts`).
 * Given ПОСЛЕДНЯЯ попытка провалена (или канал в принципе не реализован — `sms`/`web_push`,
 * см. JSDoc `attemptSend` — реализованный провайдер есть ТОЛЬКО у `telegram`, тот же пробел, что
 * `notifications.module.ts` (apps/api) документирует про `NOTIFY_PROVIDER_SMS`/`_PUSH`), Then
 * запись помечается `failed` И ставится job СЛЕДУЮЩЕГО канала по приоритету матрицы (АС2 DTJ-370),
 * если такой есть — БЕЗ повторного throw (иначе BullMQ ещё раз ретраил бы уже обработанную джобу).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import {
  findMissingTemplateVariables,
  NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
  renderTemplateString,
  type NotificationChannel,
  type NotificationDispatchJobData,
} from '@dorutj/contracts'
import { NOTIFICATION_DISPATCH_QUEUE, NOTIFICATION_DISPATCH_STORE } from './notification-dispatch.constants.js'
import type { NotificationDispatchStorePort } from './notification-dispatch-store.port.js'
import { enqueueNotificationDispatchJob } from './notification-dispatch-queue.util.js'
import { sendTelegramMessage } from './worker-telegram-sender.js'

/** Каналы БЕЗ реального провайдера в этой кодовой базе (см. JSDoc файла) — немедленный permanent-fail, без 3 бесполезных ретраев. */
const UNIMPLEMENTED_CHANNELS: ReadonlySet<NotificationChannel> = new Set(['sms', 'web_push'])

interface ChannelSendResult {
  readonly success: boolean
  readonly failedReason?: string | undefined
  /** `true` — повторять НЕ имеет смысла (например, провайдер не существует) — сразу каскад на следующий канал. */
  readonly permanent?: boolean
}

@Injectable()
export class NotificationDispatchProcessor {
  private readonly logger = new Logger(NotificationDispatchProcessor.name)

  public constructor(
    @Inject(NOTIFICATION_DISPATCH_STORE) private readonly store: NotificationDispatchStorePort,
    @Inject(NOTIFICATION_DISPATCH_QUEUE) private readonly dispatchQueue: Queue<NotificationDispatchJobData>,
  ) {}

  public async process(job: Job<NotificationDispatchJobData>): Promise<void> {
    const data = job.data
    const result = await this.attemptSend(data)

    if (result.success) {
      await this.store.markNotificationResult(data.notificationId, 'sent')
      return
    }

    const attemptsMade = job.attemptsMade + 1
    const maxAttempts = job.opts.attempts ?? NOTIFICATION_DISPATCH_MAX_ATTEMPTS
    const exhausted = result.permanent === true || attemptsMade >= maxAttempts
    if (!exhausted) {
      // BullMQ переставит по `Worker.settings.backoffStrategy` (2с/8с/32с, SRS-ADM-060).
      throw new Error(
        `notification-dispatch: попытка ${String(attemptsMade)}/${String(maxAttempts)} канала ${data.channel} ` +
          `неуспешна (userId=${data.userId}) — ${result.failedReason ?? 'нет причины'}.`,
      )
    }

    await this.store.markNotificationResult(data.notificationId, 'failed', result.failedReason)
    await this.cascadeToNextChannel(data)
  }

  /** `telegram` — реальный провайдер (fetch Bot API). `sms`/`web_push` — TODO(DTJ-371): провайдера нет НИГДЕ в кодовой базе (см. JSDoc файла). */
  private async attemptSend(data: NotificationDispatchJobData): Promise<ChannelSendResult> {
    if (UNIMPLEMENTED_CHANNELS.has(data.channel)) {
      return {
        success: false,
        permanent: true,
        failedReason: `channel=${data.channel}: провайдер не реализован (TODO(DTJ-371) — см. notifications.module.ts apps/api)`,
      }
    }
    if (data.channel !== 'telegram') {
      // `in_app` сюда не попадает по конструкции (см. JSDoc файла) — defensive, не должно случиться.
      return { success: false, permanent: true, failedReason: `неожиданный канал в очереди notification-dispatch: ${data.channel}` }
    }
    return this.sendTelegram(data)
  }

  private async sendTelegram(data: NotificationDispatchJobData): Promise<ChannelSendResult> {
    const profile = await this.store.getUserProfile(data.userId)
    if (profile?.telegramChatId == null) {
      // Критерий приёмки 2 DTJ-368 (тот же приём в TelegramNotifyProvider apps/api) — без
      // chatId retry бессмысленны, permanent-fail сразу на следующий канал.
      return { success: false, permanent: true, failedReason: 'нет telegram_chat_id пользователя' }
    }

    const template = await this.store.findTemplate(data.eventType, 'telegram', resolveLocale(profile.preferredLocale))
    if (template === null) {
      return { success: false, permanent: true, failedReason: `нет шаблона (eventType=${data.eventType}, channel=telegram)` }
    }
    const brandName = await this.store.getBrandName(data.tenantId)
    const variables = { ...data.templateVariables, brandName }
    const missing = findMissingTemplateVariables(template.requiredVariables, variables)
    if (missing.length > 0) {
      return { success: false, permanent: true, failedReason: `отсутствуют переменные шаблона: ${missing.join(', ')}` }
    }
    const text = renderChannelText(template.subject, template.body, variables)

    const botToken = process.env.TELEGRAM_BOT_TOKEN_NEUTRAL
    if (botToken === undefined || botToken.length === 0) {
      this.logger.warn('notification-dispatch: TELEGRAM_BOT_TOKEN_NEUTRAL не настроен — доставка невозможна.')
      return { success: false, permanent: true, failedReason: 'TELEGRAM_BOT_TOKEN_NEUTRAL не настроен' }
    }

    const sent = await sendTelegramMessage(botToken, profile.telegramChatId, text)
    return { success: sent.success, failedReason: sent.failedReason }
  }

  private async cascadeToNextChannel(data: NotificationDispatchJobData): Promise<void> {
    const [nextChannel, ...rest] = data.remainingChannels
    if (nextChannel === undefined) {
      // Последний канал матрицы исчерпан — панель недоставленных (DTJ-373), не блокирует бизнес-процесс.
      this.logger.warn(`notification-dispatch: все каналы исчерпаны для userId=${data.userId}, eventType=${data.eventType}.`)
      return
    }

    const record = await this.store.createNotification({
      userId: data.userId,
      tenantId: data.tenantId,
      channel: nextChannel,
      status: 'queued',
      payload: data.templateVariables,
      eventType: data.eventType,
      sourceEventId: data.sourceEventId,
    })
    if (!record.created) {
      return
    }
    const nextJobData: NotificationDispatchJobData = { ...data, channel: nextChannel, notificationId: record.id, remainingChannels: rest }
    await enqueueNotificationDispatchJob(this.dispatchQueue, nextJobData, record.id)
  }
}

function renderChannelText(subject: string | null, body: string, variables: Readonly<Record<string, string>>): string {
  const renderedBody = renderTemplateString(body, variables)
  if (subject === null || subject.length === 0) {
    return renderedBody
  }
  return `${renderTemplateString(subject, variables)}\n\n${renderedBody}`
}

function resolveLocale(rawLocale: string): string {
  return ['tj', 'ru', 'en'].includes(rawLocale) ? rawLocale : 'ru'
}
