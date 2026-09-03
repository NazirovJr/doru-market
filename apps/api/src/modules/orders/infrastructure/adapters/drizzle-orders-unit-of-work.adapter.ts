/**
 * `DrizzleOrdersUnitOfWorkAdapter` (EP-09, DTJ-227, D-EP09-21) — production-реализация
 * `OrdersUnitOfWorkPort` через `db.transaction(...)`, 1:1 паттерн
 * `modules/auth/infrastructure/adapters/drizzle-unit-of-work.adapter.ts` (волна 5), заведённый
 * заново, а не переиспользованный (порт модуль-локален, см. JSDoc порта).
 *
 * `CheckoutUseCase` вызывает `run()` ОДИН РАЗ НА ГРУППУ — `OrderRepository.save`/
 * `InventoryFacadeAdapter.reserveStock`, получившие `tx`, обязаны использовать ЕГО, не
 * дефолтный пул, иначе транзакция группы не атомарна (SRS-ORD-019, DoD тикета).
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import {
  ORDERS_UNIT_OF_WORK,
  type OrdersUnitOfWorkCallback,
  type OrdersUnitOfWorkPort,
} from '@/modules/orders/application/ports/unit-of-work.port.js'

@Injectable()
export class DrizzleOrdersUnitOfWorkAdapter implements OrdersUnitOfWorkPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async run<T>(callback: OrdersUnitOfWorkCallback<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx))
  }
}

export const ORDERS_UNIT_OF_WORK_DRIZZLE_PROVIDER = {
  provide: ORDERS_UNIT_OF_WORK,
  useClass: DrizzleOrdersUnitOfWorkAdapter,
} as const
