/**
 * Unit-тесты `CashCommissionAggregationJob` (DTJ-251) — порт замокан. Доказывает оркестрацию:
 * границы `[since,until)`/`periodStart`/`periodEnd`, идемпотентный skip (AC2), расчёт НДС при
 * issue, изоляцию ошибок ОДНОЙ сети/ОДНОГО инвойса (`Promise.allSettled`, не `Promise.all`).
 * Реальная SQL-семантика (агрегация/upsert/processed_events) — `cash-commission-aggregation.
 * job.integration.spec.ts` (РЕАЛЬНЫЙ Postgres).
 */
import { describe, expect, it, vi } from 'vitest'
import { CashCommissionAggregationJob, type CashCommissionAggregationPort } from './cash-commission-aggregation.job.js'

const NOW = new Date('2026-01-08T00:30:00Z') // четверг 05:30 Dushanbe (после DEFAULT_CASH_COMMISSION_AGGREGATION_DAILY_CRON 00:30)

function buildHarness(overrides: Partial<CashCommissionAggregationPort> = {}) {
  const aggregateByChain = vi.fn<CashCommissionAggregationPort['aggregateByChain']>().mockResolvedValue([])
  const markProcessed = vi.fn<CashCommissionAggregationPort['markProcessed']>().mockResolvedValue(true)
  const upsertDraftSubtotal = vi.fn<CashCommissionAggregationPort['upsertDraftSubtotal']>().mockResolvedValue(undefined)
  const findDraftsForPeriod = vi.fn<CashCommissionAggregationPort['findDraftsForPeriod']>().mockResolvedValue([])
  const issueInvoice = vi.fn<CashCommissionAggregationPort['issueInvoice']>().mockResolvedValue(undefined)
  const port: CashCommissionAggregationPort = {
    aggregateByChain,
    markProcessed,
    upsertDraftSubtotal,
    findDraftsForPeriod,
    issueInvoice,
    ...overrides,
  }
  const job = new CashCommissionAggregationJob(port)
  return { job, aggregateByChain, markProcessed, upsertDraftSubtotal, findDraftsForPeriod, issueInvoice }
}

describe('CashCommissionAggregationJob.runDailyAggregation (DTJ-251)', () => {
  it('вызывает aggregateByChain с границами [вчера 00:00, сегодня 00:00) Asia/Dushanbe', async () => {
    const h = buildHarness()

    await h.job.runDailyAggregation(NOW)

    expect(h.aggregateByChain).toHaveBeenCalledExactlyOnceWith(new Date('2026-01-06T19:00:00.000Z'), new Date('2026-01-07T19:00:00.000Z'))
  })

  it('новая сеть за эту дату (markProcessed=true) → upsertDraftSubtotal вызван с суммой/периодом недели, chainsProcessed=1', async () => {
    const h = buildHarness({
      aggregateByChain: vi.fn().mockResolvedValue([{ chainId: 'chain-1', totalFeeDiram: 5_000n }]),
    })

    const result = await h.job.runDailyAggregation(NOW)

    expect(h.upsertDraftSubtotal).toHaveBeenCalledExactlyOnceWith({
      chainId: 'chain-1',
      periodStart: new Date('2026-01-04T19:00:00.000Z'), // понедельник 00:00 Dushanbe недели, содержащей NOW
      periodEnd: new Date('2026-01-11T19:00:00.000Z'),
      additionalSubtotalDiram: 5_000n,
    })
    expect(result).toEqual({ chainsProcessed: 1, skippedDuplicates: 0 })
  })

  it('AC2: markProcessed=false (та же дата уже обработана) → upsertDraftSubtotal НЕ вызван, skippedDuplicates=1', async () => {
    const h = buildHarness({
      aggregateByChain: vi.fn().mockResolvedValue([{ chainId: 'chain-1', totalFeeDiram: 5_000n }]),
      markProcessed: vi.fn().mockResolvedValue(false),
    })

    const result = await h.job.runDailyAggregation(NOW)

    expect(h.upsertDraftSubtotal).not.toHaveBeenCalled()
    expect(result).toEqual({ chainsProcessed: 0, skippedDuplicates: 1 })
  })

  it('одна и та же дата (тот же NOW дважды) → одинаковый markProcessed eventId на обоих вызовах (идемпотентность ключа)', async () => {
    const h = buildHarness({ aggregateByChain: vi.fn().mockResolvedValue([{ chainId: 'chain-1', totalFeeDiram: 5_000n }]) })

    await h.job.runDailyAggregation(NOW)
    await h.job.runDailyAggregation(NOW)

    const [firstCallEventId] = h.markProcessed.mock.calls[0] ?? []
    const [secondCallEventId] = h.markProcessed.mock.calls[1] ?? []
    expect(firstCallEventId).toBe(secondCallEventId)
  })

  it('изоляция ошибок: одна сеть падает (markProcessed бросает), другая обрабатывается нормально — обе учтены в тике', async () => {
    const markProcessed = vi.fn<CashCommissionAggregationPort['markProcessed']>()
    markProcessed.mockImplementationOnce(() => Promise.reject(new Error('db down')))
    markProcessed.mockImplementation(() => Promise.resolve(true))
    const h = buildHarness({
      aggregateByChain: vi
        .fn()
        .mockResolvedValue([
          { chainId: 'chain-fail', totalFeeDiram: 1_000n },
          { chainId: 'chain-ok', totalFeeDiram: 2_000n },
        ]),
      markProcessed,
    })

    const result = await h.job.runDailyAggregation(NOW)

    expect(result.chainsProcessed).toBe(1) // только chain-ok
    expect(h.upsertDraftSubtotal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chainId: 'chain-ok' }))
  })

  it('пустой результат aggregateByChain — легальный исход, chainsProcessed=0, upsertDraftSubtotal не вызван', async () => {
    const h = buildHarness()

    const result = await h.job.runDailyAggregation(NOW)

    expect(result).toEqual({ chainsProcessed: 0, skippedDuplicates: 0 })
    expect(h.upsertDraftSubtotal).not.toHaveBeenCalled()
  })
})

describe('CashCommissionAggregationJob.runWeeklyIssue (DTJ-251)', () => {
  it('вызывает findDraftsForPeriod с началом недели Asia/Dushanbe, содержащей now', async () => {
    const h = buildHarness()

    await h.job.runWeeklyIssue(NOW)

    expect(h.findDraftsForPeriod).toHaveBeenCalledExactlyOnceWith(new Date('2026-01-04T19:00:00.000Z'))
  })

  it('AC3: draft с subtotal=100000 → issueInvoice(vat=14000,total=114000,dueAt=issuedAt+7д)', async () => {
    const h = buildHarness({
      findDraftsForPeriod: vi.fn().mockResolvedValue([{ id: 'invoice-1', subtotalDiram: 100_000n }]),
    })

    const result = await h.job.runWeeklyIssue(NOW)

    expect(h.issueInvoice).toHaveBeenCalledExactlyOnceWith({
      invoiceId: 'invoice-1',
      issuedAt: NOW,
      dueAt: new Date('2026-01-15T00:30:00.000Z'),
      vatDiram: 14_000n,
      totalDiram: 114_000n,
    })
    expect(result).toEqual({ issued: 1 })
  })

  it('несколько драфтов — каждый issue вызван независимо, ошибка одного не блокирует остальные', async () => {
    const issueInvoice = vi.fn<CashCommissionAggregationPort['issueInvoice']>()
    issueInvoice.mockImplementationOnce(() => Promise.reject(new Error('constraint violation')))
    issueInvoice.mockImplementation(() => Promise.resolve(undefined))
    const h = buildHarness({
      findDraftsForPeriod: vi.fn().mockResolvedValue([
        { id: 'invoice-fail', subtotalDiram: 1_000n },
        { id: 'invoice-ok', subtotalDiram: 2_000n },
      ]),
      issueInvoice,
    })

    const result = await h.job.runWeeklyIssue(NOW)

    expect(result).toEqual({ issued: 1 })
    expect(issueInvoice).toHaveBeenCalledTimes(2)
  })

  it('пустой результат findDraftsForPeriod — легальный исход, issued=0', async () => {
    const h = buildHarness()

    await expect(h.job.runWeeklyIssue(NOW)).resolves.toEqual({ issued: 0 })
  })
})
