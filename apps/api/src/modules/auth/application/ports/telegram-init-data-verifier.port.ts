/**
 * `TelegramInitDataVerifierPort` (EP-01, DTJ-027, SRS-API-031) — порт
 * валидации `initData` от Telegram WebApp.
 *
 * КОНКРЕТНЫЙ алгоритм (10 шагов, дословно по SRS-API-031 шаги 1-10, полный
 * текст в `docs/spec/12-api-conventions-auth-tenancy.md` §3.5):
 *   1. Парсинг `initData` как `application/x-www-form-urlencoded`.
 *   2. Извлечь и удалить `hash`.
 *   3. Отсортировать оставшиеся пары по ключу лекс., собрать
 *      `data_check_string = "{k1}={v1}\n{k2}={v2}\n..."` (значения — как есть).
 *   4. `secret_key = HMAC_SHA256(key="WebAppData", data=TELEGRAM_BOT_TOKEN)`.
 *   5. `computed_hash = HEX(HMAC_SHA256(key=secret_key, data=data_check_string))`.
 *   6. Constant-time compare `computed_hash` ↔ `hash` — иначе
 *      `InvalidTelegramInitDataError` (401 `INVALID_TELEGRAM_INIT_DATA`).
 *   7. Проверить `auth_date <= now - TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` —
 *      иначе `TelegramAuthDateExpiredError` (401 `TELEGRAM_AUTH_DATE_EXPIRED`).
 *   8. Распарсить JSON-поле `user` (см. `TelegramUser` ниже).
 *   9. Find-or-create по `(tenant_id, telegram_user_id)` (шаг 9 = ВНЕ этого
 *      порта, в `TelegramAuthUseCase`).
 *  10. JWT/refresh выпуск (ВНЕ этого порта, в `TelegramAuthUseCase`).
 *
 * Порт инкапсулирует шаги 1-8 (всё, что нужно до `User` lookup). Шаги 9-10
 * — оркестрация в use case.
 *
 * **Не валидируем подпись здесь сами** — это ответственность адаптера
 * (например, `TelegramInitDataVerifierAdapter` в `infrastructure/adapters/`).
 * Порт лишь описывает контракт: «получил initData, вернул валидный payload».
 *
 * `verify()` бросает доменные ошибки `InvalidTelegramInitDataError` /
 * `TelegramAuthDateExpiredError` (application-уровень) — это согласовано
 * с C7 (use case НЕ занимается mapping'ом ошибок, это делает
 * `AllExceptionsFilter`).
 *
 * `TelegramBotNotConfiguredError` бросает адаптер, ЕСЛИ `botToken` не передан
 * (для `TelegramAuthController` — резолвинг `TELEGRAM_BOT_TOKEN_NEUTRAL`
 * ENV возвращает `undefined`).
 */
import { type TelegramBotNotConfiguredError } from '@dorutj/contracts'

export const TELEGRAM_INIT_DATA_VERIFIER = Symbol.for('@dorutj/auth/telegram-init-data-verifier')

/**
 * Распарсенный `user`-JSON из `initData` (SRS-API-031 шаг 8,
 * Telegram WebApp `WebAppUser`).
 */
export interface TelegramUser {
  /** Telegram user id (bigint сериализуется как string в JSON). */
  readonly id: string
  readonly firstName: string
  readonly lastName: string | null
  readonly username: string | null
  readonly languageCode: string | null
}

/**
 * Успешный результат `verify()` — содержит распарсенный payload и
 * исходный `authDate` (для аудита в `AuthSession`).
 */
export interface TelegramInitDataVerified {
  readonly telegramUserId: string
  readonly authDate: Date
  readonly user: TelegramUser
}

/**
 * Параметры `verify()`:
 *   - `initData` — сырая строка из `WebApp.initData` (НЕ URL-encoded
 *     дважды, не trimmed, не modified).
 *   - `botToken` — РЕЗОЛВЛЕННЫЙ bot token (для R1 — `TELEGRAM_BOT_TOKEN_NEUTRAL`).
 *     Резолвинг в `tenant_settings` — зона R3/EP-02 (DTJ-052, white-label).
 *   - `now` — текущее время (injected, для тестируемости).
 *   - `maxAgeSeconds` — `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (default 300).
 */
export interface TelegramInitDataVerifierVerifyInput {
  readonly initData: string
  readonly botToken: string
  readonly now: Date
  readonly maxAgeSeconds: number
}

export interface TelegramInitDataVerifierPort {
  /**
   * @throws `InvalidTelegramInitDataError` (401) — невалидная подпись/формат.
   * @throws `TelegramAuthDateExpiredError` (401) — `auth_date` старше окна.
   * @throws `TelegramBotNotConfiguredError` (503) — адаптер не получил `botToken`
   *         (теоретически — если контроллер сначала вызвал verify без
   *         предварительной проверки ENV).
   */
  verify(input: TelegramInitDataVerifierVerifyInput): Promise<TelegramInitDataVerified>
}

// Re-export тип для анализаторов/тестов — фиксирует, что `TelegramBotNotConfiguredError`
// живёт в `@dorutj/contracts` и должен оставаться экспортируемым.
export type { TelegramBotNotConfiguredError }
