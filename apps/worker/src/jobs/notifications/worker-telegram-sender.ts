/** Минимальная отправка Telegram Bot API поверх `fetch()` — своя копия, apps/worker не может импортировать apps/api. */
import { Injectable } from '@nestjs/common'
import type { TelegramSenderPort, TelegramSendResult } from './telegram-sender.port.js'

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

export async function sendTelegramMessage(botToken: string, chatId: bigint, text: string): Promise<TelegramSendResult> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.toString(), text }),
    })
    const body: unknown = await response.json()
    if (!isTelegramSendMessageResponse(body) || !body.ok) {
      const description = isTelegramSendMessageResponse(body) && !body.ok ? body.description : undefined
      return { success: false, failedReason: description ?? `HTTP ${String(response.status)}` }
    }
    return { success: true, providerMessageId: String(body.result.message_id) }
  } catch (error) {
    return { success: false, failedReason: String(error) }
  }
}

@Injectable()
export class WorkerTelegramSenderAdapter implements TelegramSenderPort {
  public async send(botToken: string, chatId: bigint, text: string): Promise<TelegramSendResult> {
    return sendTelegramMessage(botToken, chatId, text)
  }
}
