/**
 * `PgPayoutSchedulerAdapter` (DTJ-249) — реализация `PayoutSchedulerPort` поверх `pg.Pool`.
 * Один параметризованный `UPDATE` (см. JSDoc `payout-scheduler.job.ts`) — `$1` связывает И
 * `due_at`, И границу сравнения `delivered_at + hold_period_days`, один снэпшот времени на
 * оба употребления вместо `NOW()` дважды.
 *
 * `updated_at = $1` — та же дисциплина, что `DrizzlePayoutScheduleRepository.reverseIfExists`
 * (apps/api, DTJ-245): любая мутация статуса бампает `updated_at`.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { PAYOUT_SCHEDULER_DB_POOL } from './payout-scheduler.constants.js'
import type { PayoutSchedulerPort } from './payout-scheduler.job.js'

const MARK_DUE_BATCH_QUERY = `
  UPDATE payout_schedule
  SET status = 'due', due_at = $1, updated_at = $1
  WHERE status = 'pending'
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE orders.id = payout_schedule.order_id
        AND orders.delivered_at + (payout_schedule.hold_period_days || ' days')::interval <= $1
    )
`

@Injectable()
export class PgPayoutSchedulerAdapter implements PayoutSchedulerPort {
  constructor(@Inject(PAYOUT_SCHEDULER_DB_POOL) private readonly pool: Pool) {}

  async markDueBatch(now: Date): Promise<number> {
    const result = await this.pool.query(MARK_DUE_BATCH_QUERY, [now])
    return result.rowCount ?? 0
  }
}
