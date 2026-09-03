/**
 * `DrizzlePaymentsUnitOfWorkAdapter` (EP-10, DTJ-242) — production-реализация
 * `PaymentsUnitOfWorkPort` через `db.transaction(...)`, 1:1 паттерн `orders/infrastructure/
 * adapters/drizzle-orders-unit-of-work.adapter.ts` (DTJ-227, D-EP09-21), заведённый заново
 * (порт модуль-локален, см. JSDoc порта).
 *
 * `HandlePaymentWebhookUseCase` вызывает `run()` РОВНО РАЗ на вебхук — идемпотентная вставка
 * `payment_operations`, `markPaidEscrow`, `EscrowLedger.append`, `outbox`-запись, получившие
 * `tx`, ОБЯЗАНЫ использовать ЕГО, не дефолтный пул, иначе атомарность (правило 2 задания) не
 * держится вовсе.
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import {
  PAYMENTS_UNIT_OF_WORK,
  type PaymentsUnitOfWorkCallback,
  type PaymentsUnitOfWorkPort,
} from '@/modules/payments/application/ports/payments-unit-of-work.port.js'

@Injectable()
export class DrizzlePaymentsUnitOfWorkAdapter implements PaymentsUnitOfWorkPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async run<T>(callback: PaymentsUnitOfWorkCallback<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx))
  }
}

export const PAYMENTS_UNIT_OF_WORK_DRIZZLE_PROVIDER = {
  provide: PAYMENTS_UNIT_OF_WORK,
  useClass: DrizzlePaymentsUnitOfWorkAdapter,
} as const
