/**
 * `DrizzleSupportOrdersFacadeAdapter` (EP-14, DTJ-279) — реализация `SupportOrdersFacadePort`
 * через прямое чтение `orders`. НЕ стаб, вопреки решению D-EP11-8 брифа
 * `reports/EP11-EP14-CTO-BRIEF.md` (волна 5, обоснование там: «OrdersFacade не существует» —
 * ссылка на состояние `orders` ДО EP-09, устаревшая на этой волне: `orders` — зрелый, стабильный
 * модуль). Тот же приём, что `DrizzlePayoutScheduleRepository.orderBelongsToTenant` (`payments`,
 * DTJ-245, принято CTO) — чтение ЧУЖОЙ Drizzle-схемы из своего `infrastructure` не является
 * межмодульным deep-import (`02` §1.1 запрещает импорт `domain`/`application` чужого модуля, не
 * импорт таблицы).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { orders } from '@/db/schema/orders.js'
import {
  SUPPORT_ORDERS_FACADE_PORT,
  type SupportOrdersFacadePort,
} from '@/modules/support/application/ports/support-orders-facade.port.js'

@Injectable()
export class DrizzleSupportOrdersFacadeAdapter implements SupportOrdersFacadePort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async belongsToCustomer(tenantId: string, orderId: string, customerId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), eq(orders.customerId, customerId)))
      .limit(1)
    return row !== undefined
  }
}

export const SUPPORT_ORDERS_FACADE_DRIZZLE_PROVIDER = {
  provide: SUPPORT_ORDERS_FACADE_PORT,
  useClass: DrizzleSupportOrdersFacadeAdapter,
} as const
