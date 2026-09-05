/**
 * Unit-тесты `PickupSlaTimeoutJob` (DTJ-254) — сканер замокан (`vi.fn()`), HTTP-мост
 * (`requestSystemOrderCancel`) — глобальный `fetch` замокан (тот же приём, что
 * `unpaid-order-timeout.job.spec.ts`, DTJ-253), без реального Postgres/BullMQ/HTTP-сервера.
 * ГЛАВНЫЙ фокус этого файла (в отличие от DTJ-253) — доказать, что `expectedFromStatus` в КАЖДОМ
 * HTTP-вызове ТОЧНО соответствует статусу СВОЕЙ строки скана, когда обе ветки (`paid_escrow`/
 * `confirmed`) присутствуют в ОДНОМ тике одновременно (AC4 тикета — «не перепутаны»). Более
 * глубокое денежное доказательство (рефанд вызван/не вызван) — `SystemCancelOrderUseCase`
 * (apps/api, DTJ-253, уже реализован и протестирован для ОБЕИХ веток DTJ-254, см. её JSDoc «МОСТ
 * МЕЖДУ ПРОЦЕССАМИ») — эта джоба НЕ вызывает рефанд сама, только корректно диспетчеризует статус.
 * Интеграционное доказательство реального SQL-скана — `pickup-sla-timeout.job.integration.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PickupSlaTimeoutJob, type ExpiredPickupOrder, type PickupSlaOrderScannerPort } from './pickup-sla-timeout.job.js'

const API_INTERNAL_URL = 'http://localhost:3000'
const INTERNAL_API_KEY = 'test-internal-key'

function fakeScanner(orders: readonly ExpiredPickupOrder[]): PickupSlaOrderScannerPort {
  return { findExpiredOrders: vi.fn<PickupSlaOrderScannerPort['findExpiredOrders']>().mockResolvedValue(orders) }
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve({ data }) } as unknown as Response
}

const NON_CASH_ORDER: ExpiredPickupOrder = { orderId: 'order-non-cash', tenantId: 'tenant-1', status: 'paid_escrow' }
const CASH_ORDER: ExpiredPickupOrder = { orderId: 'order-cash', tenantId: 'tenant-1', status: 'confirmed' }

describe('PickupSlaTimeoutJob (DTJ-254)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('AC1: non-cash (paid_escrow) заказ найден — HTTP-мост вызван с expectedFromStatus=paid_escrow, reason=pickup_sla_timeout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ orderId: NON_CASH_ORDER.orderId, status: 'cancelled', refundIssued: true }))
    const job = new PickupSlaTimeoutJob(fakeScanner([NON_CASH_ORDER]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce(new Date('2026-09-04T03:00:00.000Z'))

    expect(result).toEqual({ scanned: 1, cancelled: 1, skipped: 0 })
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    expect(call[0]).toEqual(new URL('/api/v1/internal/orders/order-non-cash/system-cancel', API_INTERNAL_URL))
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>
    expect(body).toEqual({ tenantId: 'tenant-1', expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })
  })

  it('AC2: cash (confirmed) заказ найден — HTTP-мост вызван с expectedFromStatus=confirmed (не paid_escrow), reason=pickup_sla_timeout; денежное NOOP-решение — забота apps/api, не этой джобы', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ orderId: CASH_ORDER.orderId, status: 'cancelled', refundIssued: false }))
    const job = new PickupSlaTimeoutJob(fakeScanner([CASH_ORDER]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, cancelled: 1, skipped: 0 })
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    const body = JSON.parse(call[1].body as string) as Record<string, unknown>
    expect(body).toEqual({ tenantId: 'tenant-1', expectedFromStatus: 'confirmed', reason: 'pickup_sla_timeout' })
  })

  it('AC4 (главный риск тикета): обе ветки в ОДНОМ тике одновременно — КАЖДЫЙ вызов несёт СВОЙ, не перепутанный expectedFromStatus', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: URL) => {
      const orderId = url.pathname.includes(NON_CASH_ORDER.orderId) ? NON_CASH_ORDER.orderId : CASH_ORDER.orderId
      return Promise.resolve(jsonResponse({ orderId, status: 'cancelled', refundIssued: orderId === NON_CASH_ORDER.orderId }))
    })
    const job = new PickupSlaTimeoutJob(fakeScanner([NON_CASH_ORDER, CASH_ORDER]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 2, cancelled: 2, skipped: 0 })
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as [URL, RequestInit][]
    expect(calls).toHaveLength(2)
    const bodiesByOrderId = new Map(
      calls.map(([url, init]) => [url.pathname.split('/').at(-2), JSON.parse(init.body as string) as Record<string, unknown>]),
    )
    expect(bodiesByOrderId.get(NON_CASH_ORDER.orderId)).toEqual({
      tenantId: 'tenant-1',
      expectedFromStatus: 'paid_escrow',
      reason: 'pickup_sla_timeout',
    })
    expect(bodiesByOrderId.get(CASH_ORDER.orderId)).toEqual({
      tenantId: 'tenant-1',
      expectedFromStatus: 'confirmed',
      reason: 'pickup_sla_timeout',
    })
  })

  it('AC3: пустой скан (processing-заказы исключены на уровне SQL-адаптера, не этого юнита) — fetch не вызывается', async () => {
    const job = new PickupSlaTimeoutJob(fakeScanner([]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 0, cancelled: 0, skipped: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('HTTP-мост отвечает status=skipped (гонка — заказ успел продвинуться) — учитывается как skipped, не cancelled', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ orderId: NON_CASH_ORDER.orderId, status: 'skipped', refundIssued: false }))
    const job = new PickupSlaTimeoutJob(fakeScanner([NON_CASH_ORDER]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, cancelled: 0, skipped: 1 })
  })

  it('одна отмена падает (сеть/5xx) — остальные заказы того же тика всё равно обрабатываются (Promise.allSettled), риск тикета «ошибка одной строки не прерывает батч»', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: URL) =>
      url.pathname.includes(NON_CASH_ORDER.orderId)
        ? Promise.resolve(jsonResponse({}, false, 500))
        : Promise.resolve(jsonResponse({ orderId: CASH_ORDER.orderId, status: 'cancelled', refundIssued: false })),
    )
    const job = new PickupSlaTimeoutJob(fakeScanner([NON_CASH_ORDER, CASH_ORDER]), API_INTERNAL_URL, INTERNAL_API_KEY)

    const result = await job.runOnce()

    expect(result.scanned).toBe(2)
    expect(result.cancelled).toBe(1) // cash-заказ успешен несмотря на провал non-cash заказа
  })

  it('INTERNAL_API_KEY не настроен (undefined) → отмена каждого заказа падает, но НЕ роняет весь тик (allSettled), fetch не вызывается', async () => {
    const job = new PickupSlaTimeoutJob(fakeScanner([NON_CASH_ORDER]), API_INTERNAL_URL, undefined)

    const result = await job.runOnce()

    expect(result).toEqual({ scanned: 1, cancelled: 0, skipped: 0 })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
