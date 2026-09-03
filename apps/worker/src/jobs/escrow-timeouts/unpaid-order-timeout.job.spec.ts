/**
 * Unit-тесты `UnpaidOrderTimeoutJob` (DTJ-253) — сканер замокан (`vi.fn()`), HTTP-мост
 * (`requestSystemOrderCancel`) — глобальный `fetch` замокан (тот же приём, что
 * `mock-bank-auto-pay.job.spec.ts`, DTJ-238), без реального Postgres/BullMQ/HTTP-сервера.
 * Интеграционное доказательство реального SQL-скана — `unpaid-order-timeout.job.integration.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnpaidOrderTimeoutJob, type ExpiredUnpaidOrder, type UnpaidOrderScannerPort } from './unpaid-order-timeout.job.js'

const API_INTERNAL_URL = 'http://localhost:3000'
const INTERNAL_API_KEY = 'test-internal-key'

function fakeScanner(orders: readonly ExpiredUnpaidOrder[]): UnpaidOrderScannerPort {
  return { findExpiredOrders: vi.fn<UnpaidOrderScannerPort['findExpiredOrders']>().mockResolvedValue(orders) }
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve({ data }) } as unknown as Response
}

const ORDER_A: ExpiredUnpaidOrder = { orderId: 'order-a', tenantId: 'tenant-1' }
const ORDER_B: ExpiredUnpaidOrder = { orderId: 'order-b', tenantId: 'tenant-1' }

describe('UnpaidOrderTimeoutJob (DTJ-253)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('AC1: заказ найден, HTTP-мост отменяет → cancelled=1, scanned=1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ orderId: 'order-a', status: 'cancelled', refundIssued: false }))
    const job = new UnpaidOrderTimeoutJob(fakeScanner([ORDER_A]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce(new Date('2026-09-04T03:00:00.000Z'))

    expect(result).toEqual({ scanned: 1, cancelled: 1, skipped: 0 })
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    expect(call[0]).toEqual(new URL('/api/v1/internal/orders/order-a/system-cancel', API_INTERNAL_URL))
    const headers = call[1].headers as Record<string, string>
    expect(call[1].method).toBe('POST')
    expect(headers['x-internal-api-key']).toBe(INTERNAL_API_KEY)
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>
    expect(body).toEqual({ tenantId: 'tenant-1', expectedFromStatus: 'pending_payment', reason: 'payment_timeout' })
  })

  it('AC2: заказ cash_courier не выбирается сканером вовсе (защита на уровне SQL-адаптера, не этого юнита) — здесь просто пустой скан', async () => {
    const job = new UnpaidOrderTimeoutJob(fakeScanner([]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 0, cancelled: 0, skipped: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('HTTP-мост отвечает status=skipped (гонка — заказ успел оплатиться) — учитывается как skipped, не cancelled', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ orderId: 'order-a', status: 'skipped', refundIssued: false }))
    const job = new UnpaidOrderTimeoutJob(fakeScanner([ORDER_A]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, cancelled: 0, skipped: 1 })
  })

  it('несколько заказов — каждый отменяется независимо', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: URL) =>
      Promise.resolve(
        jsonResponse({ orderId: url.pathname.includes('order-a') ? 'order-a' : 'order-b', status: 'cancelled', refundIssued: false }),
      ),
    )
    const job = new UnpaidOrderTimeoutJob(fakeScanner([ORDER_A, ORDER_B]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 2, cancelled: 2, skipped: 0 })
  })

  it('одна отмена падает (сеть/5xx) — остальные заказы того же тика всё равно обрабатываются (Promise.allSettled)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: URL) =>
      url.pathname.includes('order-a')
        ? Promise.resolve(jsonResponse({}, false, 500))
        : Promise.resolve(jsonResponse({ orderId: 'order-b', status: 'cancelled', refundIssued: false })),
    )
    const job = new UnpaidOrderTimeoutJob(fakeScanner([ORDER_A, ORDER_B]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result.scanned).toBe(2)
    expect(result.cancelled).toBe(1) // order-b успешен несмотря на провал order-a
  })

  it('INTERNAL_API_KEY не настроен (undefined) → отмена каждого заказа падает, но НЕ роняет весь тик (allSettled), fetch не вызывается', async () => {
    const job = new UnpaidOrderTimeoutJob(fakeScanner([ORDER_A]), API_INTERNAL_URL, undefined)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, cancelled: 0, skipped: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
