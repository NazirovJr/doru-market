/**
 * Самопроверка `MockTelegramBotApiServer` (DTJ-417, тест-план п.1) — Vitest, БЕЗ Playwright.
 * Критерии приёмки тикета №2/№3.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MockTelegramBotApiServer } from './mock-telegram-bot-api-server.js'

const OUTAGE_DURATION_MS = 150
const SETTLE_MARGIN_MS = 60

describe('MockTelegramBotApiServer', () => {
  let server: MockTelegramBotApiServer
  let baseUrl: string

  beforeEach(async () => {
    server = new MockTelegramBotApiServer()
    baseUrl = await server.start()
  })

  afterEach(async () => {
    await server.stop()
  })

  it('стартует на случайном свободном порту и принимает POST sendMessage', async () => {
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const response = await fetch(`${baseUrl}/bot12345:token/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: '42', text: 'привет' }),
    })

    expect(response.status).toBe(200)
    const calls = server.getReceivedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/bot12345:token/sendMessage')
    expect(calls[0]?.body).toEqual({ chat_id: '42', text: 'привет' })
  })

  it('накапливает несколько вызовов подряд', async () => {
    await fetch(`${baseUrl}/bot1/sendMessage`, { method: 'POST', body: '{}' })
    await fetch(`${baseUrl}/bot1/sendMessage`, { method: 'POST', body: '{}' })

    expect(server.getReceivedCalls()).toHaveLength(2)
  })

  it('simulateOutage: отвечает 500 в течение интервала, затем снова 200', async () => {
    server.simulateOutage(OUTAGE_DURATION_MS)

    const duringOutage = await fetch(`${baseUrl}/bot1/sendMessage`, { method: 'POST', body: '{}' })
    expect(duringOutage.status).toBe(500)

    await sleep(OUTAGE_DURATION_MS + SETTLE_MARGIN_MS)

    const afterOutage = await fetch(`${baseUrl}/bot1/sendMessage`, { method: 'POST', body: '{}' })
    expect(afterOutage.status).toBe(200)
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
