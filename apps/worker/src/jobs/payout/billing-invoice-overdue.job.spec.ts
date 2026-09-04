/**
 * Unit-тесты `BillingInvoiceOverdueJob` (DTJ-252) — порт замокан (`vi.fn()`), HTTP-мост
 * (`requestSuspendChainForUnpaidInvoice`) — глобальный `fetch` замокан (тот же приём, что
 * `unpaid-order-timeout.job.spec.ts`, DTJ-253), без реального Postgres/BullMQ/HTTP-сервера.
 * Интеграционное доказательство реального SQL-скана — `billing-invoice-overdue.job.integration.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingInvoiceOverdueJob, type BillingInvoiceOverduePort, type OverdueUnpaidInvoice } from './billing-invoice-overdue.job.js'

const API_INTERNAL_URL = 'http://localhost:3000'
const INTERNAL_API_KEY = 'test-internal-key'
const GRACE_PERIOD_DAYS = 3

/** Возвращает порт И отдельные переменные `findOverdueUnpaidInvoices`/`markOverdue` (не `port.method`) — @typescript-eslint/unbound-method. */
function fakePort(overdue: readonly OverdueUnpaidInvoice[]): {
  port: BillingInvoiceOverduePort
  findOverdueUnpaidInvoices: ReturnType<typeof vi.fn>
  markOverdue: ReturnType<typeof vi.fn>
} {
  const findOverdueUnpaidInvoices = vi.fn<BillingInvoiceOverduePort['findOverdueUnpaidInvoices']>().mockResolvedValue(overdue)
  const markOverdue = vi.fn<BillingInvoiceOverduePort['markOverdue']>().mockResolvedValue(undefined)
  return { port: { findOverdueUnpaidInvoices, markOverdue }, findOverdueUnpaidInvoices, markOverdue }
}

function jsonResponse(ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve({ data: { suspended: true } }) } as unknown as Response
}

const INVOICE_A: OverdueUnpaidInvoice = { invoiceId: 'invoice-a', chainId: 'chain-a' }
const INVOICE_B: OverdueUnpaidInvoice = { invoiceId: 'invoice-b', chainId: 'chain-b' }

describe('BillingInvoiceOverdueJob (DTJ-252)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('АС1: просроченный неоплаченный инвойс найден → HTTP suspend вызван, markOverdue вызван ПОСЛЕ успеха', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse())
    const { port, findOverdueUnpaidInvoices, markOverdue } = fakePort([INVOICE_A])
    const job = new BillingInvoiceOverdueJob(port, GRACE_PERIOD_DAYS, { apiInternalUrl: API_INTERNAL_URL, internalApiKey: INTERNAL_API_KEY })

    const result = await job.runOnce(new Date('2026-09-04T03:00:00.000Z'))

    expect(result).toEqual({ scanned: 1, suspended: 1, failed: 0 })
    expect(findOverdueUnpaidInvoices).toHaveBeenCalledWith(new Date('2026-09-04T03:00:00.000Z'), GRACE_PERIOD_DAYS)
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    expect(call[0]).toEqual(new URL('/api/v1/internal/pharmacy-chains/chain-a/suspend-for-unpaid-invoice', API_INTERNAL_URL))
    expect(call[1].method).toBe('POST')
    expect((call[1].headers as Record<string, string>)['x-internal-api-key']).toBe(INTERNAL_API_KEY)
    expect(markOverdue).toHaveBeenCalledExactlyOnceWith('invoice-a')
  })

  it('АС2: инвойс оплачен до истечения grace period не выбирается сканером вовсе (защита на уровне SQL) — здесь просто пустой скан', async () => {
    const { port } = fakePort([])
    const job = new BillingInvoiceOverdueJob(port, GRACE_PERIOD_DAYS, { apiInternalUrl: API_INTERNAL_URL, internalApiKey: INTERNAL_API_KEY })

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 0, suspended: 0, failed: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('несколько сетей — каждая приостанавливается независимо', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse())
    const { port, markOverdue } = fakePort([INVOICE_A, INVOICE_B])
    const job = new BillingInvoiceOverdueJob(port, GRACE_PERIOD_DAYS, { apiInternalUrl: API_INTERNAL_URL, internalApiKey: INTERNAL_API_KEY })

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 2, suspended: 2, failed: 0 })
    expect(markOverdue).toHaveBeenCalledTimes(2)
  })

  it('HTTP suspend падает (сеть/5xx) для одной сети — остальные обрабатываются (Promise.allSettled), markOverdue НЕ вызывается для упавшей', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: URL) =>
      Promise.resolve(url.pathname.includes('chain-a') ? jsonResponse(false, 500) : jsonResponse()),
    )
    const { port, markOverdue } = fakePort([INVOICE_A, INVOICE_B])
    const job = new BillingInvoiceOverdueJob(port, GRACE_PERIOD_DAYS, { apiInternalUrl: API_INTERNAL_URL, internalApiKey: INTERNAL_API_KEY })

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 2, suspended: 1, failed: 1 })
    expect(markOverdue).toHaveBeenCalledExactlyOnceWith('invoice-b')
    expect(markOverdue).not.toHaveBeenCalledWith('invoice-a')
  })

  it('markOverdue падает (напр. гонка БД) ПОСЛЕ успешного HTTP suspend — учитывается как failed, чекаут для сети уже заблокирован реально (HTTP уже прошёл)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse())
    const { port, markOverdue } = fakePort([INVOICE_A])
    markOverdue.mockRejectedValueOnce(new Error('db unavailable'))
    const job = new BillingInvoiceOverdueJob(port, GRACE_PERIOD_DAYS, { apiInternalUrl: API_INTERNAL_URL, internalApiKey: INTERNAL_API_KEY })

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, suspended: 0, failed: 1 })
    expect(globalThis.fetch).toHaveBeenCalledOnce() // suspend HTTP реально вызван, несмотря на последующий сбой markOverdue
  })

  it('INTERNAL_API_KEY не настроен (undefined) → suspend каждой сети падает, но НЕ роняет весь тик (allSettled), fetch не вызывается', async () => {
    const { port, markOverdue } = fakePort([INVOICE_A])
    const job = new BillingInvoiceOverdueJob(port, GRACE_PERIOD_DAYS, { apiInternalUrl: API_INTERNAL_URL, internalApiKey: undefined })

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, suspended: 0, failed: 1 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(markOverdue).not.toHaveBeenCalled()
  })
})
