import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkCallback,
  type DeliveryUnitOfWorkPort,
} from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'

@Injectable()
export class DrizzleDeliveryUnitOfWorkAdapter implements DeliveryUnitOfWorkPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async run<T>(callback: DeliveryUnitOfWorkCallback<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx))
  }
}

export const DELIVERY_UNIT_OF_WORK_PROVIDER = {
  provide: DELIVERY_UNIT_OF_WORK,
  useClass: DrizzleDeliveryUnitOfWorkAdapter,
} as const
