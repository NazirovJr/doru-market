/**
 * `PgPayoutExecutionAdapter` (DTJ-250, SRS-PAY-032/033/034) — единственная реализация
 * `PayoutExecutionStorePort`: И скан (`SELECT ... WHERE status='due'`), И финальная мутация
 * (`UPDATE ... SET status='paid'`) — ОБЕ операции `payout_schedule` напрямую из `apps/worker`
 * через СОБСТВЕННЫЙ `pg.Pool` (см. JSDoc `payout-execution.job.ts` — почему это безопасно и
 * симметрично `PayoutSchedulerJob`, DTJ-249).
 *
 * `pharmacyMerchantRef` — `pharmacy_chains.payout_merchant_ref` через `pharmacies.chain_id`
 * (LEFT JOIN — независимая аптека БЕЗ сети законно имеет `chain_id IS NULL`); `COALESCE` на
 * синтетический `'pharmacy_' || pharmacy_id` для такого случая — реальный банковский адаптер
 * (R3) эту заглушку не увидит (мок не проверяет её осмысленность, тикет явно оставляет физический
 * banking-адаптер вне периметра R1).
 *
 * `ORDER BY due_at ASC NULLS LAST, id ASC` — детерминированный порядок батча (старые `due`-строки
 * первыми; `NULLS LAST` — защитный порядок на случай отсутствия `due_at`, не наблюдалось в тестах,
 * но `PayoutSchedulerJob`/DTJ-249 не гарантирует NOT NULL на уровне схемы).
 *
 * `markPaid` — `WHERE id = ANY($2) AND status='due'` (не просто `id = ANY($2)`) — идемпотентность:
 * повторный вызов на уже `paid` строке (гипотетический двойной прогон/ретрай) ничего не
 * переписывает, тот же приём, что `DrizzlePayoutScheduleRepository.reverseIfExists` (apps/api,
 * `ne(status, 'reversed')`).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { PAYOUT_EXECUTION_DB_POOL } from './payout-execution.constants.js'
import type { DuePayoutRow, PayoutExecutionStorePort } from './payout-execution.job.js'

const FIND_DUE_PAYOUTS_QUERY = `
  SELECT ps.id AS payout_schedule_id,
         ps.net_amount_diram,
         COALESCE(pc.payout_merchant_ref, 'pharmacy_' || ps.pharmacy_id::text) AS pharmacy_merchant_ref
  FROM payout_schedule ps
  JOIN pharmacies ph ON ph.id = ps.pharmacy_id
  LEFT JOIN pharmacy_chains pc ON pc.id = ph.chain_id
  WHERE ps.status = 'due'
  ORDER BY ps.due_at ASC NULLS LAST, ps.id ASC
  LIMIT $1
`

const MARK_PAID_QUERY = `
  UPDATE payout_schedule
  SET status = 'paid', paid_at = NOW(), payout_batch_ref = $1, updated_at = NOW()
  WHERE id = ANY($2::uuid[]) AND status = 'due'
`

interface DuePayoutRowSql {
  readonly payout_schedule_id: string
  readonly net_amount_diram: string
  readonly pharmacy_merchant_ref: string
}

@Injectable()
export class PgPayoutExecutionAdapter implements PayoutExecutionStorePort {
  constructor(@Inject(PAYOUT_EXECUTION_DB_POOL) private readonly pool: Pool) {}

  async findDuePayouts(limit: number): Promise<readonly DuePayoutRow[]> {
    const result = await this.pool.query<DuePayoutRowSql>(FIND_DUE_PAYOUTS_QUERY, [limit])
    return result.rows.map((row) => ({
      payoutScheduleId: row.payout_schedule_id,
      pharmacyMerchantRef: row.pharmacy_merchant_ref,
      // `pg` возвращает BIGINT как string по умолчанию (нет OID-парсера для int8) — явный BigInt(), тот же приём, что остальные raw-SQL адаптеры денежных полей.
      amountDiram: BigInt(row.net_amount_diram),
    }))
  }

  async markPaid(payoutScheduleIds: readonly string[], batchRef: string): Promise<void> {
    if (payoutScheduleIds.length === 0) {
      return
    }
    await this.pool.query(MARK_PAID_QUERY, [batchRef, payoutScheduleIds])
  }
}
