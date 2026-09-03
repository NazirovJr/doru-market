/**
 * Реализация `CartCleanupRetentionPort` поверх `pg.Pool` (DTJ-224). ДВА параметризованных
 * `DELETE` — не требует Drizzle (см. JSDoc порта). `result.rowCount` — точное число удалённых
 * строк корзин (не `cart_items` — те каскадом, `ON DELETE CASCADE`).
 *
 * Тенант-скоуп сознательно ОТСУТСТВУЕТ (JSDoc `CartAbandonedCleanupJob` — глобальная
 * maintenance-операция вне HTTP-контекста, SRS-API-043 к ней не применяется, это явное
 * решение, не упущение).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import { CART_CLEANUP_DB_POOL } from './cart-cleanup.constants.js'
import type { CartCleanupRetentionPort } from './cart-cleanup-retention.port.js'

const DELETE_REGISTERED_SQL = 'DELETE FROM cart WHERE updated_at < $1 AND customer_id IS NOT NULL'
const DELETE_GUEST_SQL = 'DELETE FROM cart WHERE updated_at < $1 AND customer_id IS NULL'

@Injectable()
export class PgCartCleanupRetentionAdapter implements CartCleanupRetentionPort {
  constructor(@Inject(CART_CLEANUP_DB_POOL) private readonly pool: Pool) {}

  async deleteAbandonedRegisteredCarts(cutoff: Date): Promise<number> {
    const result = await this.pool.query(DELETE_REGISTERED_SQL, [cutoff])
    return result.rowCount ?? 0
  }

  async deleteAbandonedGuestCarts(cutoff: Date): Promise<number> {
    const result = await this.pool.query(DELETE_GUEST_SQL, [cutoff])
    return result.rowCount ?? 0
  }
}
