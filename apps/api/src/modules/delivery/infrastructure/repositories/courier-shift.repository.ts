import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { courierShifts, type CourierShiftRow } from '@/db/schema/courier-shifts.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { CourierShift, type CourierShiftSnapshot } from '@/modules/delivery/domain/courier-shift.entity.js'
import {
  COURIER_SHIFT_REPOSITORY,
  type CourierShiftRepositoryPort,
} from '@/modules/delivery/application/ports/courier-shift.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const ACTIVE_STATUS = 'active'

@Injectable()
export class DrizzleCourierShiftRepository implements CourierShiftRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<CourierShift | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(courierShifts).where(eq(courierShifts.id, id)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findActiveByCourierId(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<CourierShift | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client
      .select()
      .from(courierShifts)
      .where(and(eq(courierShifts.courierId, courierId), eq(courierShifts.status, ACTIVE_STATUS)))
      .orderBy(desc(courierShifts.startedAt))
      .limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async save(shift: CourierShift, tx?: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const row = toRow(shift.toSnapshot())
    await client.insert(courierShifts).values(row).onConflictDoUpdate({ target: courierShifts.id, set: row })
  }
}

function toDomain(row: CourierShiftRow): CourierShift {
  const snapshot: CourierShiftSnapshot = {
    id: row.id,
    courierId: row.courierId,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    openingCashOnHandDiram: Money.fromDiram(row.openingCashOnHandDiram),
    cashCollectedDiram: Money.fromDiram(row.cashCollectedDiram),
    cashSubmittedDiram: row.cashSubmittedDiram === null ? null : Money.fromDiram(row.cashSubmittedDiram),
    discrepancyDiram: row.discrepancyDiram,
    closedBy: row.closedBy,
    notes: row.notes,
  }
  return CourierShift.restore(snapshot)
}

function toRow(s: CourierShiftSnapshot): typeof courierShifts.$inferInsert {
  return {
    id: s.id,
    courierId: s.courierId,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    openingCashOnHandDiram: s.openingCashOnHandDiram.diram,
    cashCollectedDiram: s.cashCollectedDiram.diram,
    cashSubmittedDiram: s.cashSubmittedDiram?.diram ?? null,
    discrepancyDiram: s.discrepancyDiram,
    closedBy: s.closedBy,
    notes: s.notes,
  }
}

export const COURIER_SHIFT_REPOSITORY_PROVIDER = {
  provide: COURIER_SHIFT_REPOSITORY,
  useClass: DrizzleCourierShiftRepository,
} as const
