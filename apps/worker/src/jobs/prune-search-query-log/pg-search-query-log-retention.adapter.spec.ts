import type { Pool, QueryResult } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { PgSearchQueryLogRetentionAdapter } from './pg-search-query-log-retention.adapter.js'

describe('PgSearchQueryLogRetentionAdapter', () => {
  it('выполняет параметризованный DELETE с cutoff и возвращает rowCount', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 7 } as QueryResult)
    const pool = { query: queryMock } as unknown as Pool
    const adapter = new PgSearchQueryLogRetentionAdapter(pool)
    const cutoff = new Date('2026-03-04T10:00:00.000Z')

    const deleted = await adapter.deleteOlderThan(cutoff)

    expect(deleted).toBe(7)
    expect(queryMock).toHaveBeenCalledWith('DELETE FROM search_query_log WHERE created_at < $1', [cutoff])
  })

  it('возвращает 0, когда pg отдаёт rowCount = null (защита от нестрогой типизации драйвера)', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: null } as QueryResult)
    const pool = { query: queryMock } as unknown as Pool
    const adapter = new PgSearchQueryLogRetentionAdapter(pool)

    const deleted = await adapter.deleteOlderThan(new Date())

    expect(deleted).toBe(0)
  })
})
