/**
 * Unit-тесты `PayoutExecutionJob` (DTJ-250) — store (скан+мутация) замокан (`vi.fn()`), HTTP-мост
 * (`requestPayoutTransferBatch`) — глобальный `fetch` замокан (тот же приём, что
 * `unpaid-order-timeout.job.spec.ts`, DTJ-253/254), без реального Postgres/BullMQ/HTTP-сервера.
 * Интеграционное доказательство реального SQL-скана+мутации — `payout-execution.job.integration.
 * spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  PayoutExecutionDeps,
  PayoutExecutionJob,
  type DuePayoutRow,
  type PayoutExecutionStorePort,
} from './payout-execution.job.js'

const API_INTERNAL_URL = 'http://localhost:3000'
const INTERNAL_API_KEY = 'test-internal-key'
const BATCH_SIZE = 50

// Отдельные переменные для моков — иначе @typescript-eslint/unbound-method ругается на ссылку на
// метод интерфейса без вызова (конвенция `license-expiry-check.processor.spec.ts`/
// `outbox-relay.processor.spec.ts`).
function fakeStore(due: readonly DuePayoutRow[]): {
  store: PayoutExecutionStorePort
  findDuePayoutsMock: Mock<PayoutExecutionStorePort['findDuePayouts']>
  markPaidMock: Mock<PayoutExecutionStorePort['markPaid']>
} {
  const findDuePayoutsMock = vi.fn<PayoutExecutionStorePort['findDuePayouts']>().mockResolvedValue(due)
  const markPaidMock = vi.fn<PayoutExecutionStorePort['markPaid']>().mockResolvedValue(undefined)
  const store: PayoutExecutionStorePort = { findDuePayouts: findDuePayoutsMock, markPaid: markPaidMock }
  return { store, findDuePayoutsMock, markPaidMock }
}

function makeJob(store: PayoutExecutionStorePort): PayoutExecutionJob {
  const deps = new PayoutExecutionDeps(store, BATCH_SIZE)
  return new PayoutExecutionJob(deps, API_INTERNAL_URL, INTERNAL_API_KEY)
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve({ data }) } as unknown as Response
}

const ROW_A: DuePayoutRow = { payoutScheduleId: 'ps-a', pharmacyMerchantRef: 'merchant-a', amountDiram: 10_000n }
const ROW_B: DuePayoutRow = { payoutScheduleId: 'ps-b', pharmacyMerchantRef: 'merchant-b', amountDiram: 20_000n }
const ROW_C: DuePayoutRow = { payoutScheduleId: 'ps-c', pharmacyMerchantRef: 'merchant-c', amountDiram: 30_000n }

describe('PayoutExecutionJob (DTJ-250)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('AC4: due-строк нет — findDuePayouts вызван с batchSize, fetch/markPaid НЕ вызываются, результат нулевой', async () => {
    const { store, findDuePayoutsMock, markPaidMock } = fakeStore([])
    const job = makeJob(store)

    const result = await job.runOnce()

    expect(findDuePayoutsMock).toHaveBeenCalledExactlyOnceWith(BATCH_SIZE)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(markPaidMock).not.toHaveBeenCalled()
    expect(result).toEqual({ scanned: 0, paid: 0, stillDue: 0 })
  })

  it('Критерий 1: 3 due-строки, все подтверждены — HTTP вызван ОДНИМ батчем, markPaid вызван со всеми id и общим batchRef', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ batchRef: 'batch-1', confirmedPayoutScheduleIds: ['ps-a', 'ps-b', 'ps-c'] }))
    const { store, markPaidMock } = fakeStore([ROW_A, ROW_B, ROW_C])
    const job = makeJob(store)

    const result = await job.runOnce()

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit]
    expect(call[0]).toEqual(new URL('/api/v1/internal/payouts/transfer-batch', API_INTERNAL_URL))
    const body = JSON.parse(call[1].body as string) as { payouts: unknown[] }
    expect(body.payouts).toEqual([
      { payoutScheduleId: 'ps-a', pharmacyMerchantRef: 'merchant-a', amountDiram: '10000' },
      { payoutScheduleId: 'ps-b', pharmacyMerchantRef: 'merchant-b', amountDiram: '20000' },
      { payoutScheduleId: 'ps-c', pharmacyMerchantRef: 'merchant-c', amountDiram: '30000' },
    ])
    expect(markPaidMock).toHaveBeenCalledExactlyOnceWith(['ps-a', 'ps-b', 'ps-c'], 'batch-1')
    expect(result).toEqual({ scanned: 3, paid: 3, stillDue: 0 })
  })

  it('Критерий 2: частичный сбой (1 из 3 не подтверждена) — markPaid вызван ТОЛЬКО с 2 confirmed id, stillDue=1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ batchRef: 'batch-2', confirmedPayoutScheduleIds: ['ps-a', 'ps-c'] }))
    const { store, markPaidMock } = fakeStore([ROW_A, ROW_B, ROW_C])
    const job = makeJob(store)

    const result = await job.runOnce()

    expect(markPaidMock).toHaveBeenCalledExactlyOnceWith(['ps-a', 'ps-c'], 'batch-2')
    expect(result).toEqual({ scanned: 3, paid: 2, stillDue: 1 })
  })

  it('полный сбой (batchRef=null, ничего не подтверждено) — markPaid НЕ вызывается, все строки остаются stillDue', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ batchRef: null, confirmedPayoutScheduleIds: [] }))
    const { store, markPaidMock } = fakeStore([ROW_A, ROW_B])
    const job = makeJob(store)

    const result = await job.runOnce()

    expect(markPaidMock).not.toHaveBeenCalled()
    expect(result).toEqual({ scanned: 2, paid: 0, stillDue: 2 })
  })

  it('HTTP-мост падает (сеть/5xx) — перехвачено, markPaid НЕ вызывается, тик НЕ роняется (весь батч остаётся due для следующего прогона)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false, 500))
    const { store, markPaidMock } = fakeStore([ROW_A])
    const job = makeJob(store)

    const result = await job.runOnce()

    expect(markPaidMock).not.toHaveBeenCalled()
    expect(result).toEqual({ scanned: 1, paid: 0, stillDue: 1 })
  })

  it('INTERNAL_API_KEY не настроен (undefined) — HTTP-мост падает программной ошибкой, перехвачено, тик НЕ роняется', async () => {
    const { store, markPaidMock } = fakeStore([ROW_A])
    const deps = new PayoutExecutionDeps(store, BATCH_SIZE)
    const job = new PayoutExecutionJob(deps, API_INTERNAL_URL, undefined)

    const result = await job.runOnce()

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(markPaidMock).not.toHaveBeenCalled()
    expect(result).toEqual({ scanned: 1, paid: 0, stillDue: 1 })
  })
})
