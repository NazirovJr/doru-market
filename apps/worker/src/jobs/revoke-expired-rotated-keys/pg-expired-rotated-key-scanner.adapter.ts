import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { REVOKE_EXPIRED_ROTATED_KEYS_DB_POOL } from './revoke-expired-rotated-keys.constants.js'
import type { ExpiredRotatedKey, ExpiredRotatedKeyScannerPort } from './revoke-expired-rotated-keys.job.js'

const EXPIRED_ROTATED_KEYS_QUERY = `
  SELECT id
  FROM pharmacy_api_keys
  WHERE rotation_grace_expires_at IS NOT NULL
    AND rotation_grace_expires_at <= $1
    AND revoked_at IS NULL
`

interface ExpiredRotatedKeyRow {
  readonly id: string
}

@Injectable()
export class PgExpiredRotatedKeyScannerAdapter implements ExpiredRotatedKeyScannerPort {
  constructor(@Inject(REVOKE_EXPIRED_ROTATED_KEYS_DB_POOL) private readonly pool: Pool) {}

  async findExpiredRotatedKeys(now: Date): Promise<readonly ExpiredRotatedKey[]> {
    const result = await this.pool.query<ExpiredRotatedKeyRow>(EXPIRED_ROTATED_KEYS_QUERY, [now])
    return result.rows.map((row) => ({ keyId: row.id }))
  }
}
