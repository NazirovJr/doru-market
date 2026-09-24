// FOR UPDATE SKIP LOCKED: конкурирующий тик пропускает уже заклеймленные строки вместо ожидания.
import { Inject, Injectable } from '@nestjs/common'
import type { Pool, PoolClient } from 'pg'
import { OUTBOX_RELAY_DB_POOL } from './outbox-relay.constants.js'
import type { OutboxClaim, OutboxEventRecord, OutboxReaderPort } from './outbox-reader.port.js'

const CLAIM_QUERY = `
  SELECT id, event_type, aggregate_type, aggregate_id, tenant_id, payload, created_at
  FROM outbox
  WHERE status = 'pending'
  ORDER BY created_at
  LIMIT $1
  FOR UPDATE SKIP LOCKED
`

const MARK_PUBLISHED_QUERY = `UPDATE outbox SET status = 'published', published_at = now() WHERE id = $1`
const RECORD_FAILURE_QUERY = `UPDATE outbox SET publish_attempts = publish_attempts + 1 WHERE id = $1`

interface OutboxRowSql {
  readonly id: string
  readonly event_type: string
  readonly aggregate_type: string
  readonly aggregate_id: string
  readonly tenant_id: string | null
  readonly payload: Record<string, unknown>
  readonly created_at: Date
}

function mapRow(row: OutboxRowSql): OutboxEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    tenantId: row.tenant_id,
    payload: row.payload,
    occurredAt: row.created_at,
  }
}

// Своя транзакция на каждый вызов claimPending — не общее состояние адаптера.
class PgOutboxClaim implements OutboxClaim {
  public constructor(
    private readonly client: PoolClient,
    public readonly events: readonly OutboxEventRecord[],
  ) {}

  public async markPublished(id: string): Promise<void> {
    await this.client.query(MARK_PUBLISHED_QUERY, [id])
  }

  public async recordFailure(id: string): Promise<void> {
    await this.client.query(RECORD_FAILURE_QUERY, [id])
  }

  public async commit(): Promise<void> {
    try {
      await this.client.query('COMMIT')
    } finally {
      this.client.release()
    }
  }
}

@Injectable()
export class PgOutboxReaderAdapter implements OutboxReaderPort {
  public constructor(@Inject(OUTBOX_RELAY_DB_POOL) private readonly pool: Pool) {}

  public async claimPending(limit: number): Promise<OutboxClaim> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<OutboxRowSql>(CLAIM_QUERY, [limit])
      return new PgOutboxClaim(client, result.rows.map(mapRow))
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
      throw error
    }
  }
}
