/** Порт вокруг `sendTelegramMessage` для DI-подстановки в тестах. Тип здесь, не в адаптере — иначе цикл импорта. */
export const TELEGRAM_SENDER_PORT = Symbol('TELEGRAM_SENDER_PORT')

export interface TelegramSendResult {
  readonly success: boolean
  readonly providerMessageId?: string
  readonly failedReason?: string
}

export interface TelegramSenderPort {
  send(botToken: string, chatId: bigint, text: string): Promise<TelegramSendResult>
}
