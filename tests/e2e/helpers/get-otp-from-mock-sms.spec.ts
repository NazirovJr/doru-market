/**
 * Самопроверка `getOtpFromMockSms` (DTJ-417) — Vitest, `fetch` мокается. Живая интеграционная
 * проверка против реального `GET /api/v1/_test/last-otp` — критерий приёмки DTJ-417 №1,
 * блокирована отсутствием эндпоинта в `apps/api` на момент этого тикета (см. JSDoc хелпера).
 */
import { describe, expect, it, vi } from 'vitest'
import { getOtpFromMockSms } from './get-otp-from-mock-sms.js'

const HTTP_NOT_FOUND = 404

describe('getOtpFromMockSms', () => {
  it('возвращает код из тела ответа debug-эндпоинта и бьёт по правильному URL', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(makeResponse({ data: { code: '483920' } })))

    const code = await getOtpFromMockSms('+992901234567', {
      baseUrl: 'http://localhost:3000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(code).toBe('483920')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/_test/last-otp?phone=%2B992901234567',
    )
  })

  it('бросает понятную ошибку, если эндпоинт недоступен (не NODE_ENV=test)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(makeResponse({}, false, HTTP_NOT_FOUND)))

    await expect(
      getOtpFromMockSms('+992901234567', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/вернул 404/)
  })

  it('fallbackToSmsLog=true — явная заглушка, не молчаливая деградация', async () => {
    await expect(getOtpFromMockSms('+992901234567', { fallbackToSmsLog: true })).rejects.toThrow(
      'not implemented — see SRS-NFR-033(б)',
    )
  })
})

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}
