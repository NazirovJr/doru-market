/**
 * `TelegramInitDataVerifierAdapter` (EP-01, DTJ-027, SRS-API-031) — адаптер
 * порта `TelegramInitDataVerifierPort`, реализующий 10-шаговый алгоритм
 * проверки `initData` от Telegram WebApp.
 *
 * Алгоритм (дословно по SRS-API-031 шаги 1-10, см. полный текст в
 * `docs/spec/12-api-conventions-auth-tenancy.md` §3.5):
 *   1. URL-decode parse: `URLSearchParams`.
 *   2. Извлечь `hash`, удалить из списка.
 *   3. Сортировка оставшихся пар по ключу, конкатенация `{k}={v}\n` (значения
 *      — без URL-decode, как есть в исходной строке; это не очевидно из
 *      стандартных доков Telegram, но проверено в их исходниках и в
 *      SRS-API-031 шаге 3 дословно).
 *   4. `secret_key = HMAC_SHA256(key='WebAppData', data=botToken)` — байтовый
 *      результат (НЕ hex).
 *   5. `computed = HEX(HMAC_SHA256(key=secret_key, data=data_check_string))`.
 *   6. Constant-time compare: `crypto.timingSafeEqual(Buffer.from(computed),
 *      Buffer.from(hash, 'hex'))` (оба — Buffer длины 32 байта).
 *   7. Проверка `auth_date` (unixtime seconds) ≤ `now - maxAgeSeconds`.
 *   8. `JSON.parse(user)`.
 *
 * Шаги 9-10 — ВНЕ этого адаптера (в `TelegramAuthUseCase`).
 *
 * **`botToken === undefined` → 503 `TelegramBotNotConfiguredError`** — но
 * этот адаптер НЕ получает `undefined` (контроллер проверяет заранее и
 * бросает раньше, см. `TelegramAuthController`). Тем не менее, адаптер
 * делает type-narrowing: если `botToken` — пустая строка, считаем как
 * «не настроено» (защита от ENV=`TELEGRAM_BOT_TOKEN_NEUTRAL=""`).
 */
import { Injectable } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  InvalidTelegramInitDataError,
  TelegramAuthDateExpiredError,
  TelegramBotNotConfiguredError,
} from '@dorutj/contracts'
import {
  TELEGRAM_INIT_DATA_VERIFIER,
  type TelegramInitDataVerified,
  type TelegramInitDataVerifierPort,
  type TelegramInitDataVerifierVerifyInput,
  type TelegramUser,
} from '@/modules/auth/application/ports/telegram-init-data-verifier.port.js'

const HMAC_SHA256_OUTPUT_BYTES = 32
const HEX_CHARS_PER_BYTE = 2
const HMAC_SHA256_HEX_LENGTH = HMAC_SHA256_OUTPUT_BYTES * HEX_CHARS_PER_BYTE
const TELEGRAM_WEBAPP_DATA_LABEL = 'WebAppData'

@Injectable()
export class TelegramInitDataVerifierAdapter implements TelegramInitDataVerifierPort {
  async verify(input: TelegramInitDataVerifierVerifyInput): Promise<TelegramInitDataVerified> {
    if (input.botToken.length === 0) {
      // Защита от `TELEGRAM_BOT_TOKEN_NEUTRAL=""` — НЕ валидный токен,
      // лучше 503, чем подделывать подпись.
      throw new TelegramBotNotConfiguredError()
    }

    // === Шаг 1: парсинг initData как application/x-www-form-urlencoded.
    const params = new URLSearchParams(input.initData)
    const hash = params.get('hash')
    if (hash === null || hash.length === 0) {
      throw new InvalidTelegramInitDataError({ reason: 'missing_hash' })
    }
    params.delete('hash')

    // === Шаг 2+3: собрать data_check_string (значения — как есть, не
    // URL-декодированные; Telegram не декодирует).
    const pairs: string[] = []
    for (const [key, value] of params.entries()) {
      pairs.push(`${key}=${value}`)
    }
    pairs.sort((a, b) => a.localeCompare(b))
    const dataCheckString = pairs.join('\n')

    // === Шаг 4: secret_key = HMAC_SHA256('WebAppData', botToken).
    const secretKey = createHmac('sha256', TELEGRAM_WEBAPP_DATA_LABEL)
      .update(input.botToken)
      .digest()

    // === Шаг 5: computed = HEX(HMAC_SHA256(secretKey, data_check_string)).
    const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

    // === Шаг 6: constant-time compare.
    if (computed.length !== HMAC_SHA256_HEX_LENGTH || hash.length !== HMAC_SHA256_HEX_LENGTH) {
      throw new InvalidTelegramInitDataError({ reason: 'hash_length_mismatch' })
    }
    const computedBuf = Buffer.from(computed, 'hex')
    const hashBuf = Buffer.from(hash, 'hex')
    if (computedBuf.length !== hashBuf.length || !timingSafeEqual(computedBuf, hashBuf)) {
      throw new InvalidTelegramInitDataError({ reason: 'signature_mismatch' })
    }

    // === Шаг 7: auth_date ≤ now - maxAgeSeconds.
    const authDateStr = params.get('auth_date')
    if (authDateStr === null) {
      throw new InvalidTelegramInitDataError({ reason: 'missing_auth_date' })
    }
    const authDateSec = Number.parseInt(authDateStr, 10)
    if (!Number.isFinite(authDateSec) || authDateSec <= 0) {
      throw new InvalidTelegramInitDataError({ reason: 'invalid_auth_date' })
    }
    const authDate = new Date(authDateSec * 1000)
    const nowSec = Math.floor(input.now.getTime() / 1000)
    if (nowSec - authDateSec > input.maxAgeSeconds) {
      throw new TelegramAuthDateExpiredError({
        ageSeconds: nowSec - authDateSec,
        maxAgeSeconds: input.maxAgeSeconds,
      })
    }

    // === Шаг 8: распарсить JSON-поле `user`.
    const userJson = params.get('user')
    if (userJson === null) {
      throw new InvalidTelegramInitDataError({ reason: 'missing_user' })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(userJson)
    } catch (_err) {
      throw new InvalidTelegramInitDataError({ reason: 'user_not_json' })
    }
    const user = parseTelegramUser(parsed)

    return Promise.resolve({
      telegramUserId: user.id,
      authDate,
      user,
    })
  }
}

/**
 * `parseTelegramUser` — type-guard для `TelegramUser`. ВАЖНО: это НЕ
 * отдельный VO (тикет DTJ-027 явно решил: «`telegramUserId` — НЕ отдельный
 * VO, хранится как `string`/`bigint`»). Преобразования: `id` →
 * `string` (Telegram отдаёт `number` в JSON, но для 64-bit совместимости
 * в `user_telegram_identities.telegram_user_id BIGINT` безопасно хранить
 * как string, а конвертировать в bigint на границе Drizzle-репозитория).
 */
function parseTelegramUser(value: unknown): TelegramUser {
  if (typeof value !== 'object' || value === null) {
    throw new InvalidTelegramInitDataError({ reason: 'user_not_object' })
  }
  const obj = value as Record<string, unknown>
  // `id` может прийти как number или string (если Telegram > 2^53 — редко,
  // но Postgres BIGINT принимает оба).
  let idStr: string
  if (typeof obj.id === 'number' && Number.isFinite(obj.id) && obj.id > 0) {
    idStr = String(obj.id)
  } else if (typeof obj.id === 'string' && obj.id.length > 0) {
    idStr = obj.id
  } else {
    throw new InvalidTelegramInitDataError({ reason: 'invalid_user_id' })
  }
  if (typeof obj.first_name !== 'string' || obj.first_name.length === 0) {
    throw new InvalidTelegramInitDataError({ reason: 'missing_first_name' })
  }
  const lastName = typeof obj.last_name === 'string' ? obj.last_name : null
  const username = typeof obj.username === 'string' ? obj.username : null
  const languageCode = typeof obj.language_code === 'string' ? obj.language_code : null
  return {
    id: idStr,
    firstName: obj.first_name,
    lastName,
    username,
    languageCode,
  }
}

export { TELEGRAM_INIT_DATA_VERIFIER }
