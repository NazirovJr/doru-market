/**
 * Unit-тесты `PayoutSchedulerJob` (DTJ-249) — порт замокан, доказывает только оркестрацию
 * (делегирование `now`, форма результата, логирование не бросает). Реальная SQL-семантика
 * (батч, изоляция disputed) — `payout-scheduler.job.integration.spec.ts` (РЕАЛЬНЫЙ Postgres).
 */
import { describe, expect, it, vi } from 'vitest'
import { PayoutSchedulerJob, type PayoutSchedulerPort } from './payout-scheduler.job.js'

function buildHarness(movedToDue: number) {
  const markDueBatch = vi.fn<PayoutSchedulerPort['markDueBatch']>().mockResolvedValue(movedToDue)
  const port: PayoutSchedulerPort = { markDueBatch }
  const job = new PayoutSchedulerJob(port)
  return { job, markDueBatch }
}

describe('PayoutSchedulerJob (DTJ-249)', () => {
  it('runOnce делегирует переданный now порту и возвращает movedToDue из его результата', async () => {
    const h = buildHarness(3)
    const now = new Date('2026-09-04T10:00:00Z')

    const result = await h.job.runOnce(now)

    expect(h.markDueBatch).toHaveBeenCalledExactlyOnceWith(now)
    expect(result).toEqual({ movedToDue: 3 })
  })

  it('runOnce без аргумента использует Date.now() по умолчанию (не бросает, не требует now)', async () => {
    const h = buildHarness(0)

    const result = await h.job.runOnce()

    expect(h.markDueBatch).toHaveBeenCalledOnce()
    expect(h.markDueBatch.mock.calls[0]?.[0]).toBeInstanceOf(Date)
    expect(result).toEqual({ movedToDue: 0 })
  })

  it('movedToDue=0 (ни одна строка не затронута) — легальный исход, не ошибка', async () => {
    const h = buildHarness(0)

    await expect(h.job.runOnce(new Date())).resolves.toEqual({ movedToDue: 0 })
  })
})
