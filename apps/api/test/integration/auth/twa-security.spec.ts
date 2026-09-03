/**
 * `twa-security.spec.ts` (EP-01, DTJ-029.5, SRS-API-031/032) — сквозной
 * интеграционный security-сьют TWA-flow (`POST /api/v1/auth/telegram`).
 *
 * Сценарии (из `docs/06-CURRENT-PROGRESS.md` §9.3 + `DTJ-029.md` §«Что сделать»
 * критерий «TWA-flow не покрыт security-тестами»):
 *   1. **Happy path**: валидно подписанный `initData` → 200 + пара токенов
 *      + создана `user_telegram_identities`-запись (через повторный login тем же
 *      telegramUserId — find-or-create возвращает существующего User, не дубль).
 *   2. **Forge initData** (MITM): подпись валидна для ОДНОГО payload, атакующий
 *      подменяет `user.id` (без пересчёта hash) → 401 INVALID_TELEGRAM_INIT_DATA.
 *      Защита — constant-time compare `crypto.timingSafeEqual` (DTJ-027 §6).
 *   3. **Forge under another bot**: initData подписан для бота A, проверен
 *      против бота B → 401 INVALID_TELEGRAM_INIT_DATA. (Имитация атаки на чужой
 *      канал — критично для multi-tenant White-Label, R3, DTJ-058/062.)
 *   4. **Replay** (старый `auth_date`): `auth_date` старше
 *      `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (тест-ENV = 300с) → 401
 *      TELEGRAM_AUTH_DATE_EXPIRED. Отдельный код от INVALID_TELEGRAM_INIT_DATA
 *      (SRS-API-031 шаг 7 — «разные причины»).
 *   5. **Граница replay** (auth_date ровно `now - maxAge`): НЕ считается
 *      истёкшим (`nowSec - authDateSec > maxAgeSeconds` — строгое `>`),
 *      200 OK. Документирует поведение «ровно на границе — пропускаем».
 *   6. **Bot not configured**: `TELEGRAM_BOT_TOKEN_NEUTRAL=""` → 503
 *      SERVICE_UNAVAILABLE (`reason: telegram_bot_not_configured`). Защита
 *      от случайно не настроенного ENV (DTJ-023/024 §«Риски»).
 *   7. **Missing `hash` field**: `initData` без `hash=…` → 401
 *      INVALID_TELEGRAM_INIT_DATA (SRS-API-031 шаг 2).
 *   8. **Missing `user` field**: `initData` без `user=…` → 401
 *      INVALID_TELEGRAM_INIT_DATA (SRS-API-031 шаг 8).
 *   9. **`user` — невалидный JSON**: подпись валидна, но `user` — не JSON →
 *      401 INVALID_TELEGRAM_INIT_DATA.
 *
 * Платформенное требование: реальные `dorutj_test` Postgres/Redis (волна 5
 * блок A, `test-app.ts` → `AuthModule` на Drizzle/Redis-адаптерах). Подпись
 * `initData` считается по тому же алгоритму, что и в production-адаптере
 * (SRS-API-031 шаги 3-5); см. helper `signInitData()` ниже (зеркало
 * `telegram-init-data-verifier.adapter.spec.ts`).
 *
 * Каждый тест ссылается на конкретный шаг SRS-API-031 / код ошибки — это
 * упрощает ревью «какие ветки покрыты» без перечитывания теста.
 */
import { createHmac } from 'node:crypto'
import type { Server } from 'node:http'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const WEBAPP_DATA_LABEL = 'WebAppData'
const TEST_BOT_TOKEN = 'test-bot-token-for-integration'
const ALTERNATE_BOT_TOKEN = 'attacker-controlled-bot-token'

/**
 * Зеркало production-алгоритма подписи `initData` (SRS-API-031 шаги 1-5).
 * Сортируем параметры по ключу, склеиваем `{k}={v}\n` (значения — as-is,
 * без URL-decode), считаем `secret_key = HMAC_SHA256('WebAppData', botToken)`,
 * затем `hash = HEX(HMAC_SHA256(secret_key, data_check_string))`. URL-encode
 * пар ключ/значение для отправки (стандартный `application/x-www-form-urlencoded`).
 */
function signInitData(
  params: Readonly<Record<string, string>>,
  botToken: string = TEST_BOT_TOKEN,
): string {
  const secretKey = createHmac('sha256', WEBAPP_DATA_LABEL).update(botToken).digest()
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('\n')
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  return `${Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')}&hash=${hash}`
}

interface ErrorBody {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details?: Record<string, unknown>
  }
}

interface TelegramAuthResponseBody {
  readonly data: {
    readonly accessToken: string
    readonly refreshToken: string
    readonly user: {
      readonly id: string
      readonly role: string
      readonly tenantId: string | null
      readonly phoneNumber: string | null
      readonly fullName: string | null
    }
    readonly telegram: {
      readonly telegramUserId: string
      readonly firstName: string
      readonly lastName: string | null
      readonly username: string | null
    }
  }
}

describe('auth.twa-security (DTJ-029.5, SRS-API-031/032)', () => {
  let ctx: TestApp
  let httpServer: Server

  beforeEach(async () => {
    ctx = await createTestApp()
    httpServer = ctx.httpServer
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('1. happy path: валидная подпись + свежий auth_date → 200 + пара токенов', async () => {
    const authDate = Math.floor(Date.now() / 1000) - 10
    const initData = signInitData({
      auth_date: String(authDate),
      user: JSON.stringify({
        id: 555111222,
        first_name: 'Тестовый',
        last_name: 'Пользователь',
        username: 'tester_tj',
        language_code: 'ru',
      }),
      query_id: 'AAEh12345',
    })

    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData })

    expect(response.status).toBe(200)
    const body = response.body as TelegramAuthResponseBody
    expect(body.data.accessToken).toBeTypeOf('string')
    expect(body.data.accessToken.length).toBeGreaterThan(0)
    expect(body.data.refreshToken).toBeTypeOf('string')
    expect(body.data.refreshToken.length).toBeGreaterThan(0)
    expect(body.data.user.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(body.data.user.role).toBe('customer')
    // Telegram-путь ВСЕГДА возвращает phoneNumber=null (до запроса телефона
    // при оформлении заказа, DTJ-027 §«Шаги 9-10»).
    expect(body.data.user.phoneNumber).toBeNull()
    expect(body.data.telegram.telegramUserId).toBe('555111222')
    expect(body.data.telegram.firstName).toBe('Тестовый')
    expect(body.data.telegram.lastName).toBe('Пользователь')
    expect(body.data.telegram.username).toBe('tester_tj')
  })

  it('1b. повторный login тем же telegramUserId → find-or-create возвращает того же User (не дубль)', async () => {
    // Первый login.
    const authDate1 = Math.floor(Date.now() / 1000) - 5
    const initData1 = signInitData({
      auth_date: String(authDate1),
      user: JSON.stringify({ id: 777888999, first_name: 'Повтор' }),
    })
    const first = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData: initData1 })
      .expect(200)
    const firstBody = first.body as TelegramAuthResponseBody
    const firstUserId = firstBody.data.user.id
    const firstAccess = firstBody.data.accessToken
    expect(firstUserId).toBeTruthy()

    // Второй login — НОВЫЙ initData (свежий auth_date), тот же telegramUserId.
    // Ожидаем: ТОТ ЖЕ user.id (find-or-create на identity нашёл), НОВЫЕ токены
    // (новая auth_sessions-строка, DTJ-027 §«Идемпотентность»).
    const authDate2 = Math.floor(Date.now() / 1000) - 1
    const initData2 = signInitData({
      auth_date: String(authDate2),
      user: JSON.stringify({ id: 777888999, first_name: 'Повтор' }),
    })
    const second = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData: initData2 })
      .expect(200)
    const secondBody = second.body as TelegramAuthResponseBody
    expect(secondBody.data.user.id).toBe(firstUserId)
    // refreshToken обязан быть НОВЫМ (новая сессия) — отличается от первого.
    expect(secondBody.data.accessToken).not.toBe(firstAccess)
  })

  it('2. forge initData (MITM): подмена user.id без пересчёта hash → 401 INVALID_TELEGRAM_INIT_DATA', async () => {
    // Атакующий: подписывает payload с user.id=1, затем подменяет user.id на 999.
    // hash становится невалидным → адаптер отклоняет (constant-time compare,
    // DTJ-027 шаг 6 — `crypto.timingSafeEqual`).
    const authDate = Math.floor(Date.now() / 1000) - 10
    const legitInitData = signInitData({
      auth_date: String(authDate),
      user: JSON.stringify({ id: 1, first_name: 'Legit' }),
    })
    // Подменяем JSON-значение `user` после подписи (значение URL-encoded через
    // `encodeURIComponent` — цифры НЕ percent-encode'ятся, это unreserved-символы,
    // RFC 3986 §2.3). В исходной строке `id` остаётся литеральной `1`, а НЕ `%31`
    // (старый паттерн ожидал `%31` и никогда не матчился — regex.replace() был
    // no-op, sanity-проверка ниже ловила это как "подмена не сработала").
    // Итоговая подстрока: `user=%7B%22id%22%3A1%2C%22first_name%22%3A%22Legit%22%7D`.
    const forged = legitInitData.replace(
      /user=(%7B%22id%22%3A)1(%2C%22first_name%22%3A%22Legit%22%7D)/,
      'user=%7B%22id%22%3A999%2C%22first_name%22%3A%22Legit%22%7D',
    )
    expect(forged).not.toBe(legitInitData) // sanity: подмена сработала

    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData: forged })
    expect(response.status).toBe(401)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('INVALID_TELEGRAM_INIT_DATA')
  })

  it('3. forge under another bot: подписан для бота A, проверен против бота B → 401', async () => {
    // Multi-tenant сценарий: инициатор пытается залогиниться через чужого
    // бота (White-Label per-tenant ботов в R3, DTJ-058/062). Адаптер
    // вычисляет secret_key из botToken, переданного в `verify()` — если
    // botToken не совпадает с тем, под которым подписан initData, hash не
    // совпадёт.
    const authDate = Math.floor(Date.now() / 1000) - 10
    const initData = signInitData(
      {
        auth_date: String(authDate),
        user: JSON.stringify({ id: 42, first_name: 'Cross' }),
      },
      ALTERNATE_BOT_TOKEN,
    )
    // В test-app TELEGRAM_BOT_TOKEN_NEUTRAL = TEST_BOT_TOKEN, а не ALTERNATE_BOT_TOKEN.
    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData })
    expect(response.status).toBe(401)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('INVALID_TELEGRAM_INIT_DATA')
  })

  it('4. replay: auth_date старше TELEGRAM_INIT_DATA_MAX_AGE_SECONDS → 401 TELEGRAM_AUTH_DATE_EXPIRED', async () => {
    // 600 секунд назад при окне 300с.
    const oldAuthDate = Math.floor(Date.now() / 1000) - 600
    const initData = signInitData({
      auth_date: String(oldAuthDate),
      user: JSON.stringify({ id: 100, first_name: 'Replay' }),
    })

    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData })
    expect(response.status).toBe(401)
    const body = response.body as ErrorBody
    // Отдельный код от INVALID_TELEGRAM_INIT_DATA (SRS-API-031 шаг 7,
    // «разные причины — атакующий не должен отличать replay от forge по коду ошибки»).
    expect(body.error.code).toBe('TELEGRAM_AUTH_DATE_EXPIRED')
    expect(body.error.details).toBeDefined()
    expect(body.error.details?.maxAgeSeconds).toBe(300)
  })

  it('5. граница replay: auth_date ровно now - maxAge → 200 OK (строгое > в compare)', async () => {
    // SRS-API-031 шаг 7: `nowSec - authDateSec > maxAgeSeconds` — строгое `>`.
    // Если разница РОВНО maxAge — НЕ считается истёкшим. Это поведение
    // зафиксировано в `telegram-init-data-verifier.adapter.ts:105` и должно
    // быть стабильным (если кто-то изменит на `>=` — этот тест упадёт,
    // заставляя осознанно обновить).
    const nowSec = Math.floor(Date.now() / 1000)
    const boundaryAuthDate = nowSec - 300 // ровно maxAge
    const initData = signInitData({
      auth_date: String(boundaryAuthDate),
      user: JSON.stringify({ id: 200, first_name: 'Boundary' }),
    })

    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData })
    // Допускаем 200 (если граница ещё не сдвинулась) или 401 (если 1с прошла
    // пока формировался запрос). Главное — НЕ TELEGRAM_AUTH_DATE_EXPIRED,
    // если 200; иначе код всё равно 401, но с EXPIRED — тест упадёт.
    if (response.status === 200) {
      const body = response.body as TelegramAuthResponseBody
      expect(body.data.user.role).toBe('customer')
    } else {
      // Если истекло на момент проверки (граничный кейс) — допустимо,
      // но в тесте мы хотим явно видеть, что на границе 200.
      expect(response.status).toBe(200)
    }
  })

  it('6. bot not configured: TELEGRAM_BOT_TOKEN_NEUTRAL="" → 503 SERVICE_UNAVAILABLE', async () => {
    // Подменяем ENV ДО второго `createTestApp()` (applyTestEnv идемпотентен,
    // но мы хотим чистый сценарий «бот не настроен»).
    const previous = process.env.TELEGRAM_BOT_TOKEN_NEUTRAL
    process.env.TELEGRAM_BOT_TOKEN_NEUTRAL = ''
    try {
      // ВАЖНО: каждый TestApp изолирован, но ConfigService читает ENV ОДИН
      // раз при `ConfigModule.forRoot()`. Чтобы подхватить пустой токен,
      // нужен новый модуль — закрываем текущий и поднимаем заново.
      await ctx.close()
      ctx = await createTestApp()
      httpServer = ctx.httpServer

      // Подпись валидна, но адаптер выбросит `TelegramBotNotConfiguredError`
      // (защита от пустого botToken, DTJ-027 §«botToken === undefined»).
      const authDate = Math.floor(Date.now() / 1000) - 5
      const initData = signInitData({
        auth_date: String(authDate),
        user: JSON.stringify({ id: 300, first_name: 'NoBot' }),
      })

      const response = await request(httpServer)
        .post('/api/v1/auth/telegram')
        .send({ initData })
      expect(response.status).toBe(503)
      const body = response.body as ErrorBody
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
      expect(body.error.details?.reason).toBe('telegram_bot_not_configured')
    } finally {
      // Восстанавливаем ENV для последующих тестов в этом describe-блоке.
      if (previous === undefined) {
        delete process.env.TELEGRAM_BOT_TOKEN_NEUTRAL
      } else {
        process.env.TELEGRAM_BOT_TOKEN_NEUTRAL = previous
      }
    }
  })

  it('7. missing hash: initData без hash=… → 401 INVALID_TELEGRAM_INIT_DATA', async () => {
    const initData =
      'auth_date=' +
      String(Math.floor(Date.now() / 1000)) +
      '&user=' +
      encodeURIComponent('{"id":400,"first_name":"NoHash"}')

    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData })
    expect(response.status).toBe(401)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('INVALID_TELEGRAM_INIT_DATA')
    // reason: 'missing_hash' (DTJ-027 шаг 2) — не палит, что именно отсутствует
    // (для атакующего бесполезная информация), но для ops-диагностики полезно.
    expect(body.error.details?.reason).toBe('missing_hash')
  })

  it('8. missing user: initData без user=… → 401 INVALID_TELEGRAM_INIT_DATA', async () => {
    // Подпись валидна (один параметр auth_date + hash). Адаптер пройдёт
    // шаги 1-7 и упадёт на шаге 8 — нет `user`.
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000) - 5),
    })

    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData })
    expect(response.status).toBe(401)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('INVALID_TELEGRAM_INIT_DATA')
    expect(body.error.details?.reason).toBe('missing_user')
  })

  it('9. user невалидный JSON: подпись валидна, но user=NOT-A-JSON → 401', async () => {
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000) - 5),
      user: 'NOT-A-JSON',
    })

    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData })
    expect(response.status).toBe(401)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('INVALID_TELEGRAM_INIT_DATA')
    expect(body.error.details?.reason).toBe('user_not_json')
  })

  it('10. zod валидация DTO: пустой initData → 400 VALIDATION_ERROR (Zod pipe)', async () => {
    // Zod `telegramAuthDtoSchema` имеет `initData: z.string() min(1)`.
    // Пустая строка отклоняется Zod-пайпом ДО use case.
    const response = await request(httpServer)
      .post('/api/v1/auth/telegram')
      .send({ initData: '' })
    expect(response.status).toBe(400)
    const body = response.body as ErrorBody
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})
