/**
 * Unit-тесты `TelegramInitDataVerifierAdapter` (EP-01, DTJ-027, SRS-API-031).
 *
 * Алгоритм 10 шагов покрыт:
 *   1. Парсинг URL-encoded initData + извлечение hash
 *   2. Сортировка, склейка data_check_string
 *   3. secret_key = HMAC_SHA256('WebAppData', botToken)
 *   4. computed = HEX(HMAC_SHA256(secret_key, data_check_string))
 *   5. constant-time compare
 *   6. auth_date ≤ now - maxAgeSeconds
 *   7. user JSON-парсинг
 */
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InvalidTelegramInitDataError,
  TelegramAuthDateExpiredError,
  TelegramBotNotConfiguredError,
} from '@dorutj/contracts'
import { TelegramInitDataVerifierAdapter } from './telegram-init-data-verifier.adapter.js'

const WEBAPP_DATA_LABEL = 'WebAppData'
const BOT_TOKEN = '1234567890:AABBccDDee_ffGGHHii-jjKKllmmNN'

// Удобный хелпер: подписать initData по алгоритму Telegram.
function signInitData(
  params: Readonly<Record<string, string>>,
  botToken = BOT_TOKEN,
): string {
  const secretKey = createHmac('sha256', WEBAPP_DATA_LABEL).update(botToken).digest()
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n')
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  return `${Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')}&hash=${hash}`
}

describe('TelegramInitDataVerifierAdapter (DTJ-027, SRS-API-031)', () => {
  let adapter: TelegramInitDataVerifierAdapter

  beforeEach(() => {
    adapter = new TelegramInitDataVerifierAdapter()
  })

  it('1. happy path: валидная подпись + свежий auth_date → telegramUserId + user', async () => {
    const authDate = Math.floor(Date.now() / 1000) - 10 // 10 секунд назад
    const initData = signInitData({
      auth_date: String(authDate),
      user: JSON.stringify({
        id: 987654321,
        first_name: 'Иван',
        last_name: 'Иванов',
        username: 'ivan_ru',
        language_code: 'ru',
      }),
      query_id: 'AAEh...',
    })
    const verified = await adapter.verify({
      initData,
      botToken: BOT_TOKEN,
      now: new Date(),
      maxAgeSeconds: 300,
    })
    expect(verified.telegramUserId).toBe('987654321')
    expect(verified.user.firstName).toBe('Иван')
    expect(verified.user.lastName).toBe('Иванов')
    expect(verified.user.username).toBe('ivan_ru')
    expect(verified.user.languageCode).toBe('ru')
    expect(verified.authDate).toBeInstanceOf(Date)
  })

  it('2. неверная подпись → InvalidTelegramInitDataError(reason=signature_mismatch)', async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: '{"id":1,"first_name":"x"}',
    })
    // Меняем `hash` после подписи — имитируем MITM
    const tampered = initData.replace(/hash=[a-f0-9]+$/, 'hash=' + '0'.repeat(64))
    await expect(
      adapter.verify({ initData: tampered, botToken: BOT_TOKEN, now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(InvalidTelegramInitDataError)
  })

  it('3. неправильный bot_token → InvalidTelegramInitDataError', async () => {
    const initData = signInitData(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: '{"id":1,"first_name":"x"}',
      },
      BOT_TOKEN,
    )
    // Подпись сделана для BOT_TOKEN, но проверяем с ДРУГИМ токеном
    await expect(
      adapter.verify({
        initData,
        botToken: 'WRONG_TOKEN',
        now: new Date(),
        maxAgeSeconds: 300,
      }),
    ).rejects.toBeInstanceOf(InvalidTelegramInitDataError)
  })

  it('4. истёкший auth_date (10 минут назад, окно 300с) → TelegramAuthDateExpiredError', async () => {
    const oldAuthDate = Math.floor(Date.now() / 1000) - 600
    const initData = signInitData({
      auth_date: String(oldAuthDate),
      user: '{"id":1,"first_name":"x"}',
    })
    await expect(
      adapter.verify({ initData, botToken: BOT_TOKEN, now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(TelegramAuthDateExpiredError)
  })

  it('5. отсутствует hash → InvalidTelegramInitDataError(reason=missing_hash)', async () => {
    const initData = 'auth_date=1&user=' + encodeURIComponent('{"id":1,"first_name":"x"}')
    await expect(
      adapter.verify({ initData, botToken: BOT_TOKEN, now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(InvalidTelegramInitDataError)
  })

  it('6. отсутствует user → InvalidTelegramInitDataError(reason=missing_user)', async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
    })
    await expect(
      adapter.verify({ initData, botToken: BOT_TOKEN, now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(InvalidTelegramInitDataError)
  })

  it('7. user невалидный JSON → InvalidTelegramInitDataError(reason=user_not_json)', async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: 'NOT-A-JSON',
    })
    await expect(
      adapter.verify({ initData, botToken: BOT_TOKEN, now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(InvalidTelegramInitDataError)
  })

  it('8. user без first_name → InvalidTelegramInitDataError(reason=missing_first_name)', async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 1 }),
    })
    await expect(
      adapter.verify({ initData, botToken: BOT_TOKEN, now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(InvalidTelegramInitDataError)
  })

  it('9. пустой botToken → TelegramBotNotConfiguredError', async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: '{"id":1,"first_name":"x"}',
    })
    await expect(
      adapter.verify({ initData, botToken: '', now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(TelegramBotNotConfiguredError)
  })

  it('10. hash не hex (длина 64) → InvalidTelegramInitDataError(reason=hash_length_mismatch)', async () => {
    // Формируем initData с hash=short — подпись пройдёт parse, но упадёт на длине
    const initData = 'auth_date=1&user=' + encodeURIComponent('{"id":1,"first_name":"x"}') + '&hash=short'
    await expect(
      adapter.verify({ initData, botToken: BOT_TOKEN, now: new Date(), maxAgeSeconds: 300 }),
    ).rejects.toBeInstanceOf(InvalidTelegramInitDataError)
  })

  it('11. user.id как string (большое число) → telegramUserId=string', async () => {
    // Некоторые клиенты Telegram сериализуют id как string, если > 2^53
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: '9007199254740992', first_name: 'big' }),
    })
    const verified = await adapter.verify({
      initData,
      botToken: BOT_TOKEN,
      now: new Date(),
      maxAgeSeconds: 300,
    })
    expect(verified.telegramUserId).toBe('9007199254740992')
  })
})
