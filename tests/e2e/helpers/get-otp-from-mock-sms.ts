/**
 * `getOtpFromMockSms` (DTJ-417, `SRS-NFR-033`) — читает код, отправленный `MockSmsProvider`,
 * БЕЗ реального SMS-канала. Вызывается СРАЗУ после `POST /api/v1/auth/otp/request` для номера.
 *
 * Путь (а) — основной, полностью рабочий: `GET /api/v1/_test/last-otp?phone=...` (debug-
 * эндпоинт, доступен ТОЛЬКО при `NODE_ENV=test`, физически отсутствует в prod-сборке —
 * `SRS-NFR-033`). Эндпоинт реализуется владельцем Auth-модуля (EP-01) по этому контракту —
 * на момент этого тикета ещё не появился в `apps/api` (см. `tickets/ep10-ux-devops-tests/
 * DTJ-417.md`, «Риски и подводные камни»), поэтому клиент здесь пишется СТРОГО по контракту.
 *
 * Путь (б) — запасной, читает `notifications(channel='sms')` через REST — эндпоинт чтения
 * уведомлений ещё не существует нигде в репозитории на момент этого тикета (см. `grep -rn
 * "notifications" apps/api/src/modules/notifications` перед реализацией: только запись/
 * consumer, эндпоинта чтения нет) — реализация НАМЕРЕННО заглушка, чтобы не блокировать
 * готовностью чужого, ещё не построенного REST-контракта.
 */

const DEFAULT_TEST_API_BASE_URL = 'http://localhost:3000'
const LAST_OTP_PATH = '/api/v1/_test/last-otp'

export interface GetOtpFromMockSmsOptions {
  /** Базовый URL API (без хвостового `/`). По умолчанию `E2E_BASE_URL`/`http://localhost:3000`. */
  readonly baseUrl?: string
  /**
   * Запасной путь `SRS-NFR-033`(б) — чтение `notifications(channel='sms')` напрямую. НЕ
   * реализован (REST-эндпоинт чтения уведомлений ещё не существует) — бросает явную ошибку,
   * а не молча деградирует до основного пути (иначе вызывающий тест не заметил бы подмену).
   */
  readonly fallbackToSmsLog?: boolean
  /** Подмена `fetch` — только для юнит-теста этого хелпера. */
  readonly fetchImpl?: typeof fetch
}

interface LastOtpResponse {
  readonly data: { readonly code: string }
}

/**
 * Возвращает последний OTP-код, отправленный `MockSmsProvider` на `phone` (`SRS-NFR-033`,
 * путь (а)). Бросает, если эндпоинт недоступен (не `NODE_ENV=test`) или для номера ещё нет
 * записи.
 */
export async function getOtpFromMockSms(phone: string, options: GetOtpFromMockSmsOptions = {}): Promise<string> {
  if (options.fallbackToSmsLog === true) {
    // Дословный текст ошибки зафиксирован тикетом (tickets/ep10-ux-devops-tests/DTJ-417.md,
    // «Что сделать» п.3) — REST-эндпоинт чтения notifications(channel='sms') ещё не
    // существует нигде в репозитории, заглушка не блокирует этот тикет его отсутствием.
    throw new Error('not implemented — see SRS-NFR-033(б)')
  }

  const baseUrl = options.baseUrl ?? process.env.E2E_BASE_URL ?? DEFAULT_TEST_API_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const url = `${baseUrl}${LAST_OTP_PATH}?phone=${encodeURIComponent(phone)}`

  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(
      `getOtpFromMockSms: GET ${url} вернул ${String(response.status)} — ` +
        'убедитесь, что NODE_ENV=test на бэкенде и OTP реально запрошен перед вызовом хелпера',
    )
  }

  const body = (await response.json()) as LastOtpResponse
  const code = body.data.code
  if (typeof code !== 'string' || code.length === 0) {
    throw new Error(`getOtpFromMockSms: неожиданное тело ответа ${url}: ${JSON.stringify(body)}`)
  }
  return code
}
