/**
 * Самопроверка `waitForReady` (DTJ-417, тест-план п.3) — Vitest, БЕЗ Playwright, `fetch` мокается.
 */
import { describe, expect, it, vi } from 'vitest'
import { waitForReady } from './wait-for-ready.js'

const NOT_READY_STATUS = 503
const READY_STATUS = 200

describe('waitForReady', () => {
  it('ждёт, пока эндпоинт не начнёт отвечать 200, и не завершается раньше времени', async () => {
    let calls = 0
    const fetchImpl = vi.fn(() => {
      calls += 1
      const status = calls < 3 ? NOT_READY_STATUS : READY_STATUS
      return Promise.resolve({ status })
    })

    await waitForReady({
      url: 'http://localhost:3000/ready',
      intervalMs: 0,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(calls).toBe(3)
  })

  it('бросает понятную ошибку по истечении таймаута, а не висит бесконечно', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ status: NOT_READY_STATUS }))

    await expect(
      waitForReady({
        url: 'http://localhost:3000/ready',
        intervalMs: 0,
        timeoutMs: 10,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/не ответил 200/)
  })

  it('трактует сетевую ошибку как «ещё не готов», а не как фатальный сбой', async () => {
    let calls = 0
    const fetchImpl = vi.fn(() => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('ECONNREFUSED'))
      return Promise.resolve({ status: READY_STATUS })
    })

    await waitForReady({
      url: 'http://localhost:3000/ready',
      intervalMs: 0,
      timeoutMs: 5_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(calls).toBe(2)
  })
})
