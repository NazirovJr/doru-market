import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { PgReportExportStoreAdapter } from './pg-report-export-store.adapter.js'

function buildHarness() {
  const queryMock = vi.fn().mockResolvedValue(undefined)
  const pool = { query: queryMock } as unknown as Pool
  return { adapter: new PgReportExportStoreAdapter(pool), queryMock }
}

describe('PgReportExportStoreAdapter', () => {
  it('markReady — UPDATE status=ready с download_url/completed_at', async () => {
    const { adapter, queryMock } = buildHarness()
    const completedAt = new Date('2026-09-27T10:00:00.000Z')

    await adapter.markReady('job-1', 'file:///tmp/job-1.csv', completedAt)

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("status = 'ready'"), ['job-1', 'file:///tmp/job-1.csv', completedAt])
  })

  it('markFailed — UPDATE status=failed', async () => {
    const { adapter, queryMock } = buildHarness()
    const completedAt = new Date('2026-09-27T10:00:00.000Z')

    await adapter.markFailed('job-1', completedAt)

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("status = 'failed'"), ['job-1', completedAt])
  })
})
