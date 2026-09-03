/**
 * Порт очистки брошенных корзин (DTJ-224, SRS-ORD-005..009, `02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §1.3: interface + DI-токен рядом). Таблица `cart` определена в схеме `apps/api`
 * (`db/schema/cart.ts`) — `apps/worker` не подключает чужой Drizzle-граф ради двух `DELETE`,
 * реализация порта (`PgCartCleanupRetentionAdapter`) использует параметризованный raw SQL
 * через `pg`.
 *
 * ДВА независимых метода (не один с параметром) — регистрированные и гостевые корзины несут
 * РАЗНЫЕ горизонты хранения (ticket «Технический контекст»: 30 дней / 7 дней) и разные
 * `cutoff`, вычисленные джобой (`CartAbandonedCleanupJob.runOnce`) независимо друг от друга.
 * `cart_items` каскадом удаляется самим Postgres (`ON DELETE CASCADE`,
 * `0023_orders_cart.sql`) — порт не трогает `cart_items` напрямую.
 */
export const CART_CLEANUP_RETENTION_PORT = Symbol('CART_CLEANUP_RETENTION_PORT')

export interface CartCleanupRetentionPort {
  /** Hard-delete `cart` с `customer_id IS NOT NULL` и `updated_at < cutoff`. Возвращает число удалённых строк. */
  deleteAbandonedRegisteredCarts(cutoff: Date): Promise<number>

  /** Hard-delete ГОСТЕВЫХ `cart` (`customer_id IS NULL`) с `updated_at < cutoff`. */
  deleteAbandonedGuestCarts(cutoff: Date): Promise<number>
}
