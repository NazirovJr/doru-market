/**
 * Unit-тесты `SupportSlaMonitorJob` (DTJ-280) — сканер замокан (`vi.fn()`), HTTP-мост
 * (`requestEscalateSupportTicketPriority`) — глобальный `fetch` замокан, тот же приём, что
 * `pickup-sla-timeout.job.spec.ts` (DTJ-254), без реального Postgres/BullMQ/HTTP-сервера.
 * Критерии приёмки 1/2 (выборка/эскалация) — здесь через мок скана (сам SQL — интеграционный
 * тест). Критерий приёмки 4 (изоляция сбоя одного тикета, `Promise.allSettled`) — здесь.
 * Критерий приёмки 3 (анти-дребезг) — забота SQL `WHERE` скана, не этого юнита (см. JSDoc job.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportSlaMonitorJob, type OverdueSupportTicket, type SupportSlaTicketScannerPort } from './support-sla-monitor.job.js'

const API_INTERNAL_URL = 'http://localhost:3000'
const INTERNAL_API_KEY = 'test-internal-key'
const RE_ESCALATION_COOLDOWN_MINUTES = 30

function fakeScanner(tickets: readonly OverdueSupportTicket[]): SupportSlaTicketScannerPort {
  return { findOverdueTickets: vi.fn<SupportSlaTicketScannerPort['findOverdueTickets']>().mockResolvedValue(tickets) }
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve({ data }) } as unknown as Response
}

const TICKET_A: OverdueSupportTicket = { ticketId: 'ticket-a', tenantId: 'tenant-1' }
const TICKET_B: OverdueSupportTicket = { ticketId: 'ticket-b', tenantId: 'tenant-1' }

// `internalApiKey` — БЕЗ значения по умолчанию: default-параметр JS подставляется и при
// ЯВНО переданном `undefined` (не только при пропущенном аргументе), что молча превращало
// `buildJob(scanner, undefined)` обратно в `INTERNAL_API_KEY` — тест «ключ не настроен» на
// самом деле гонял fetch с настоящим ключом. Обязательный параметр закрывает эту дыру.
function buildJob(scanner: SupportSlaTicketScannerPort, internalApiKey: string | undefined): SupportSlaMonitorJob {
  return new SupportSlaMonitorJob(scanner, API_INTERNAL_URL, internalApiKey, RE_ESCALATION_COOLDOWN_MINUTES)
}

describe('SupportSlaMonitorJob (DTJ-280)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('критерий приёмки 1 — тикет найден сканом → HTTP-мост вызван РОВНО один раз на escalate-priority этого тикета, reEscalationCooldownMinutes передан в скан', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ticketId: TICKET_A.ticketId, priority: 1 }))
    // Отдельная переменная для мока — иначе @typescript-eslint/unbound-method ругается на ссылку
    // на метод интерфейса без вызова (конвенция `payout-execution.job.spec.ts`/
    // `license-expiry-check.processor.spec.ts`).
    const findOverdueTicketsMock = vi.fn<SupportSlaTicketScannerPort['findOverdueTickets']>().mockResolvedValue([TICKET_A])
    const scanner: SupportSlaTicketScannerPort = { findOverdueTickets: findOverdueTicketsMock }
    const job = buildJob(scanner, INTERNAL_API_KEY)

    const now = new Date('2026-09-04T03:00:00.000Z')
    const result = await job.runOnce(now)

    expect(result).toEqual({ scanned: 1, escalated: 1, failed: 0 })
    expect(findOverdueTicketsMock).toHaveBeenCalledWith(now, RE_ESCALATION_COOLDOWN_MINUTES)
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    expect(call[0]).toEqual(new URL(`/api/v1/internal/support-tickets/${TICKET_A.ticketId}/escalate-priority`, API_INTERNAL_URL))
    expect(call[1].headers).toMatchObject({ 'x-internal-api-key': INTERNAL_API_KEY })
  })

  it('критерий приёмки 2 (негативный, на уровне джобы) — скан вернул пустой список (тикет с first_responded_at заполнен исключён SQL-запросом) → fetch не вызывается', async () => {
    const job = buildJob(fakeScanner([]), INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 0, escalated: 0, failed: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('критерий приёмки 4 — один из N тикетов падает (5xx), остальные N-1 всё равно эскалированы (Promise.allSettled, не Promise.all)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: URL) =>
      url.pathname.includes(TICKET_A.ticketId)
        ? Promise.resolve(jsonResponse({}, false, 500))
        : Promise.resolve(jsonResponse({ ticketId: TICKET_B.ticketId, priority: 1 })),
    )
    const job = buildJob(fakeScanner([TICKET_A, TICKET_B]), INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result.scanned).toBe(2)
    expect(result.escalated).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('INTERNAL_API_KEY не настроен (undefined) → эскалация каждого тикета падает, но НЕ роняет весь тик (allSettled), fetch не вызывается', async () => {
    const job = buildJob(fakeScanner([TICKET_A]), undefined)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, escalated: 0, failed: 1 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
