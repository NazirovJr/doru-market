import type { Pool, QueryResult } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { PgCartCleanupRetentionAdapter } from './pg-cart-cleanup-retention.adapter.js'

describe('PgCartCleanupRetentionAdapter', () => {
  it('deleteAbandonedRegisteredCarts — DELETE с customer_id IS NOT NULL, возвращает rowCount', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 4 } as QueryResult)
    const pool = { query: queryMock } as unknown as Pool
    const adapter = new PgCartCleanupRetentionAdapter(pool)
    const cutoff = new Date('2026-08-03T10:00:00.000Z')

    const deleted = await adapter.deleteAbandonedRegisteredCarts(cutoff)

    expect(deleted).toBe(4)
    expect(queryMock).toHaveBeenCalledWith('DELETE FROM cart WHERE updated_at < $1 AND customer_id IS NOT NULL', [
      cutoff,
    ])
  })

  it('deleteAbandonedGuestCarts — DELETE с customer_id IS NULL, СВОЙ cutoff', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 2 } as QueryResult)
    const pool = { query: queryMock } as unknown as Pool
    const adapter = new PgCartCleanupRetentionAdapter(pool)
    const cutoff = new Date('2026-08-26T10:00:00.000Z')

    const deleted = await adapter.deleteAbandonedGuestCarts(cutoff)

    expect(deleted).toBe(2)
    expect(queryMock).toHaveBeenCalledWith('DELETE FROM cart WHERE updated_at < $1 AND customer_id IS NULL', [
      cutoff,
    ])
  })

  it('возвращает 0, когда pg отдаёт rowCount = null (защита от нестрогой типизации драйвера)', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: null } as QueryResult)
    const pool = { query: queryMock } as unknown as Pool
    const adapter = new PgCartCleanupRetentionAdapter(pool)

    expect(await adapter.deleteAbandonedRegisteredCarts(new Date())).toBe(0)
    expect(await adapter.deleteAbandonedGuestCarts(new Date())).toBe(0)
  })
})
