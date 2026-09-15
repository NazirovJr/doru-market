/**
 * `TelegramNotifyProvider` (DTJ-368, EP-16, `SRS-ADM-051`) — единственная реализация канала
 * `telegram` БЕЗ Mock (тестовое окружение использует тестовый Bot API токен — см. «Риски» тикета,
 * этот адаптер переиспользует УЖЕ существующий `TELEGRAM_BOT_TOKEN_NEUTRAL`, см. ниже §«Токен»).
 *
 * Given `telegramChatId IS NULL` (пользователь не открывал TWA) → `send()` возвращает
 * `{ success: false }` НЕМЕДЛЕННО, без обращения к внешнему API (критерий приёмки 2 DTJ-368) —
 * не тратить retry-бюджет диспетчера на заведомо невозможную доставку.
 *
 * §«Токен» — тикет описывает отдельную переменную `TELEGRAM_BOT_TOKEN_TEST` для тестов. В
 * репозитории уже есть ЕДИНЫЙ `TELEGRAM_BOT_TOKEN_NEUTRAL` (`AppConfigService.telegramBotTokenNeutral`,
 * DTJ-027, EP-01), которым УЖЕ пользуются `TelegramAuthUseCase`/тесты (dev/test окружение
 * подставляет тестовое значение в ТУ ЖЕ переменную, не заводит вторую). Заведение
 * `TELEGRAM_BOT_TOKEN_TEST` рядом создало бы два конкурирующих источника правды для одного
 * бота нейтрального тенанта — переиспользован существующий (тот же принцип «не создавай
 * дублирующую сущность под другим именем», см. риски DTJ-368 про `IdentityFacadePort`). В R3
 * (White-Label, per-tenant боты) обе точки — `TelegramAuthUseCase` и этот провайдер — будут
 * читать `tenant_settings.telegram_bot_token_ref` (задел уже есть в схеме `tenants`), не в
 * периметре этого тикета.
 *
 * §«Библиотека Telegram Bot API» — выбор Tech Lead на старте реализации (см. риски тикета,
 * `01-TECH-BASELINE.md` версию не фиксирует): сырой `fetch()` POST на
 * `https://api.telegram.org/bot<token>/sendMessage`, БЕЗ SDK-зависимости
 * (`node-telegram-bot-api`/аналоги ориентированы на ПРИЁМ сообщений/long-polling — лишний вес для
 * send-only использования). Тот же приём уже применяется в `apps/worker/.../mock-bank-auto-pay.job.ts`
 * (сырой `fetch()` вместо HTTP-клиента общего назначения) и в `TelegramInitDataVerifierAdapter`
 * (ручной HMAC вместо Telegram SDK) — общая идиома репозитория: не тянуть SDK ради одного вызова.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort } from '@/modules/notifications/application/ports/identity-facade.port.js'
import {
  type NotificationChannel,
  type NotifyProviderPort,
  type NotifySendResult,
  type RenderedNotificationMessage,
} from '@/modules/notifications/application/ports/notify-provider.port.js'

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org'

interface TelegramSendMessageOkResponse {
  readonly ok: true
  readonly result: { readonly message_id: number }
}
interface TelegramSendMessageErrorResponse {
  readonly ok: false
  readonly description?: string
}
type TelegramSendMessageResponse = TelegramSendMessageOkResponse | TelegramSendMessageErrorResponse

function isTelegramSendMessageResponse(value: unknown): value is TelegramSendMessageResponse {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean'
}

function composeText(message: RenderedNotificationMessage): string {
  return message.subject === undefined || message.subject.length === 0 ? message.body : `${message.subject}\n\n${message.body}`
}

interface SendMessageCommand {
  readonly botToken: string
  readonly chatId: bigint
  readonly message: RenderedNotificationMessage
  readonly userId: string
}

@Injectable()
export class TelegramNotifyProvider implements NotifyProviderPort {
  private readonly logger = new Logger(TelegramNotifyProvider.name)

  public constructor(
    @Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort,
    // esbuild/vitest не эмитит design:paramtypes (DTJ-001) — явный @Inject обязателен, тот же
    // приём, что TelegramAuthUseCase.
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  public async send(
    userId: string,
    channel: NotificationChannel,
    message: RenderedNotificationMessage,
  ): Promise<NotifySendResult> {
    const profile = await this.identityFacade.getRecipientProfile(userId)
    const chatId = profile?.telegramChatId ?? null
    if (chatId === null) {
      // Критерий приёмки 2 DTJ-368: без chatId (или без пользователя) — ни одного сетевого вызова.
      return { success: false }
    }

    const botToken = this.config.telegramBotTokenNeutral
    if (botToken === undefined || botToken.length === 0) {
      this.logger.warn(`telegram-notify: TELEGRAM_BOT_TOKEN_NEUTRAL не настроен, канал=${channel}, userId=${userId} — доставка невозможна.`)
      return { success: false }
    }

    return this.callSendMessage({ botToken, chatId, message, userId })
  }

  private async callSendMessage(command: SendMessageCommand): Promise<NotifySendResult> {
    try {
      const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${command.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: command.chatId.toString(), text: composeText(command.message) }),
      })
      const body: unknown = await response.json()
      if (!isTelegramSendMessageResponse(body) || !body.ok) {
        const description = isTelegramSendMessageResponse(body) && !body.ok ? body.description : undefined
        this.logger.warn(`telegram-notify: Bot API отклонил sendMessage для userId=${command.userId} — ${description ?? `HTTP ${String(response.status)}`}.`)
        return { success: false }
      }
      return { success: true, providerMessageId: String(body.result.message_id) }
    } catch (error) {
      this.logger.error(`telegram-notify: сетевая ошибка sendMessage для userId=${command.userId} — ${String(error)}.`)
      return { success: false }
    }
  }
}
