/**
 * `NotifyProviderPort` (DTJ-368, EP-16) — единый интерфейс отправки для ВСЕХ 4 каналов
 * доставки (D-23): Telegram (основной), SMS (fallback), web push (дополнительный), in-app
 * (гарантированный минимум). Полиморфизм — через DI-токен ПО КАНАЛУ (`NOTIFY_PROVIDER_TELEGRAM`,
 * `NOTIFY_PROVIDER_SMS`, `NOTIFY_PROVIDER_PUSH`, `NOTIFY_PROVIDER_IN_APP`), не через ветвление
 * внутри одной реализации — связывание в `notifications.module.ts`.
 *
 * `channel` передаётся В `send()` (не только выводится из токена) — вызывающий диспетчер
 * (матрица DTJ-370) выбирает провайдера ПО каналу и передаёт то же значение внутрь для
 * логирования/самопроверки; конкретная реализация не обязана его использовать для ветвления.
 *
 * **НЕ throw для ожидаемых случаев недоставки** (нет `telegramChatId`, канал не настроен) —
 * контракт этого порта: `{ success: false }`. Исключение допустимо только для непредвиденного
 * сбоя (сеть, парсинг) — тот же принцип, что `05-DEVELOPER-HANDBOOK.md` §10 "не подделывай
 * правдоподобный успех", здесь наоборот: не подделывай правдоподобный ПРОВАЛ броском там, где
 * вызывающий код (диспетчер DTJ-370) ожидает булев результат, чтобы решить про retry/fallback-канал.
 *
 * **Реестр каналов разошёлся с `docs/spec/11-database-schema.md`** (`notification_channel` ENUM
 * там — `'telegram' | 'sms' | 'web_push' | 'email'`, БЕЗ `in_app` и С `email`, которого нет среди
 * 4 каналов задачи D-23/тикета). Взят состав ИЗ ТИКЕТА (источник истины для этого тикета) — миграция
 * реального Postgres ENUM (DTJ-369/370) обязана согласовать типы на месте (добавить `in_app`,
 * решить судьбу `email` — вне периметра этого скелет-тикета).
 */

/** Состав — см. JSDoc файла §«Реестр каналов разошёлся». */
export type NotificationChannel = 'telegram' | 'sms' | 'web_push' | 'in_app'

export interface RenderedNotificationMessage {
  readonly subject?: string
  readonly body: string
}

export interface NotifySendResult {
  readonly success: boolean
  readonly providerMessageId?: string
}

/**
 * DTJ-370 — расширение, предсказанное JSDoc файла §1 (`eventType` заполнится вызывающей стороной
 * с доступом к событию): `sourceEventId` нужен `InAppNotifyProvider`, чтобы передать его в
 * `NotificationsRepositoryPort.create()` для идемпотентности (`SRS-ADM-057`). Необязателен — не
 * ломает существующих вызывающих (`ListOwnNotificationsUseCase` и т.п. этот метод не вызывают).
 */
export interface NotifySendContext {
  readonly eventType?: string
  readonly sourceEventId?: string
}

export interface NotifyProviderPort {
  send(
    userId: string,
    channel: NotificationChannel,
    message: RenderedNotificationMessage,
    context?: NotifySendContext,
  ): Promise<NotifySendResult>
}

/** DI-токены по каналу (см. JSDoc файла §1 про полиморфизм через токен, не ветвление). */
export const NOTIFY_PROVIDER_TELEGRAM = Symbol.for('@dorutj/notifications/notify-provider-telegram')
export const NOTIFY_PROVIDER_SMS = Symbol.for('@dorutj/notifications/notify-provider-sms')
export const NOTIFY_PROVIDER_PUSH = Symbol.for('@dorutj/notifications/notify-provider-push')
export const NOTIFY_PROVIDER_IN_APP = Symbol.for('@dorutj/notifications/notify-provider-in-app')
