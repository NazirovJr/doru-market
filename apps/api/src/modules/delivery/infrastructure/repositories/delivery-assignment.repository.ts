import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { deliveryAssignments, type DeliveryAssignmentRow } from '@/db/schema/delivery-assignments.js'
import { deliveryOffers } from '@/db/schema/delivery-offers.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { DeliveryAssignment } from '@/modules/delivery/domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '@/modules/delivery/domain/delivery-assignment-snapshot.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  TERMINAL_DELIVERY_ASSIGNMENT_STATUSES,
  type AssignUnassignedInput,
  type DeliveryAssignmentRepositoryPort,
  type FindByCourierAndStatusesInput,
  type FindByStatusesInput,
} from '@/modules/delivery/application/ports/delivery-assignment.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

// «В пуле» — нет pending/accepted оффера этого назначения.
const NOT_IN_ACTIVE_OFFER = sql`NOT EXISTS (
  SELECT 1 FROM ${deliveryOffers}
  WHERE ${deliveryOffers.deliveryAssignmentId} = ${deliveryAssignments.id}
    AND ${deliveryOffers.status} IN ('pending', 'accepted')
)`

@Injectable()
export class DrizzleDeliveryAssignmentRepository implements DeliveryAssignmentRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(deliveryAssignments).where(eq(deliveryAssignments.id, id)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findActiveByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client
      .select()
      .from(deliveryAssignments)
      .where(
        and(
          eq(deliveryAssignments.orderId, orderId),
          notInArray(deliveryAssignments.status, [...TERMINAL_DELIVERY_ASSIGNMENT_STATUSES]),
        ),
      )
      .limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryAssignment | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(deliveryAssignments).where(eq(deliveryAssignments.orderId, orderId)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async hasActiveAssignmentForCourier(courierId: string, tx?: DeliveryUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client
      .select({ id: deliveryAssignments.id })
      .from(deliveryAssignments)
      .where(
        and(
          eq(deliveryAssignments.courierId, courierId),
          notInArray(deliveryAssignments.status, [...TERMINAL_DELIVERY_ASSIGNMENT_STATUSES]),
        ),
      )
      .limit(1)
    return row !== undefined
  }

  public async claimUnassigned(input: AssignUnassignedInput, tx: DeliveryUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const result = await client
      .update(deliveryAssignments)
      .set({ status: 'assigned', courierId: input.courierId, assignedAt: input.now })
      .where(and(eq(deliveryAssignments.id, input.id), eq(deliveryAssignments.status, 'unassigned'), NOT_IN_ACTIVE_OFFER))
      .returning({ id: deliveryAssignments.id })
    return result.length > 0
  }

  public async assignManual(input: AssignUnassignedInput, tx: DeliveryUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const result = await client
      .update(deliveryAssignments)
      .set({ status: 'assigned', courierId: input.courierId, assignedAt: input.now })
      .where(and(eq(deliveryAssignments.id, input.id), eq(deliveryAssignments.status, 'unassigned')))
      .returning({ id: deliveryAssignments.id })
    return result.length > 0
  }

  public async findUnassignedPool(tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryAssignment[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(deliveryAssignments)
      .where(and(eq(deliveryAssignments.status, 'unassigned'), NOT_IN_ACTIVE_OFFER))
    return rows.map(toDomain)
  }

  public async findByStatuses(input: FindByStatusesInput, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryAssignment[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const { statuses, limit, cursor } = input
    const conditions = [inArray(deliveryAssignments.status, [...statuses])]
    if (cursor !== null) {
      // createdAt DESC, id DESC — устойчивый tie-break на одинаковый createdAt (тот же приём, что courier-earnings.repository.ts).
      const keysetCondition = or(
        lt(deliveryAssignments.createdAt, cursor.createdAt),
        and(eq(deliveryAssignments.createdAt, cursor.createdAt), lt(deliveryAssignments.id, cursor.id)),
      )
      if (keysetCondition !== undefined) {
        conditions.push(keysetCondition)
      }
    }
    const rows = await client
      .select()
      .from(deliveryAssignments)
      .where(and(...conditions))
      .orderBy(desc(deliveryAssignments.createdAt), desc(deliveryAssignments.id))
      .limit(limit)
    return rows.map(toDomain)
  }

  // ДОБАВЛЕНО (DTJ-317) — 1:1 с findByStatuses, + courierId (GET /delivery-assignments/mine).
  public async findByCourierAndStatuses(
    input: FindByCourierAndStatusesInput,
    tx?: DeliveryUnitOfWorkTx,
  ): Promise<readonly DeliveryAssignment[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const { courierId, statuses, limit, cursor } = input
    const conditions = [eq(deliveryAssignments.courierId, courierId), inArray(deliveryAssignments.status, [...statuses])]
    if (cursor !== null) {
      const keysetCondition = or(
        lt(deliveryAssignments.createdAt, cursor.createdAt),
        and(eq(deliveryAssignments.createdAt, cursor.createdAt), lt(deliveryAssignments.id, cursor.id)),
      )
      if (keysetCondition !== undefined) {
        conditions.push(keysetCondition)
      }
    }
    const rows = await client
      .select()
      .from(deliveryAssignments)
      .where(and(...conditions))
      .orderBy(desc(deliveryAssignments.createdAt), desc(deliveryAssignments.id))
      .limit(limit)
    return rows.map(toDomain)
  }

  public async save(assignment: DeliveryAssignment, tx?: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const row = toRow(assignment.toSnapshot())
    await client
      .insert(deliveryAssignments)
      .values(row)
      .onConflictDoUpdate({ target: deliveryAssignments.id, set: row })
  }
}

function toDomain(row: DeliveryAssignmentRow): DeliveryAssignment {
  const snapshot: DeliveryAssignmentSnapshot = {
    id: row.id,
    orderId: row.orderId,
    courierId: row.courierId,
    status: row.status,
    landmarkText: row.landmarkText,
    handoverOtpId: row.handoverOtpId,
    cashCollectedDiram: row.cashCollectedDiram === null ? null : Money.fromDiram(row.cashCollectedDiram),
    cashChangeDiram: row.cashChangeDiram === null ? null : Money.fromDiram(row.cashChangeDiram),
    reassignReason: row.reassignReason,
    reassignedBy: row.reassignedBy,
    assignedAt: row.assignedAt,
    pickedUpFromPharmacyAt: row.pickedUpFromPharmacyAt,
    deliveredAt: row.deliveredAt,
    failedReason: row.failedReason,
    createdAt: row.createdAt ?? new Date(0),
    requiresColdChain: row.requiresColdChain,
    coldChainBagConfirmed: row.coldChainBagConfirmed,
    coldChainBagConfirmedAt: row.coldChainBagConfirmedAt,
    contactAttemptsCount: row.contactAttemptsCount,
    lastContactAttemptAt: row.lastContactAttemptAt,
    distanceMeters: row.distanceMeters,
    proofPhotoUrl: row.proofPhotoUrl,
  }
  return DeliveryAssignment.restore(snapshot)
}

function toRow(s: DeliveryAssignmentSnapshot): typeof deliveryAssignments.$inferInsert {
  return {
    id: s.id,
    orderId: s.orderId,
    courierId: s.courierId,
    status: s.status,
    landmarkText: s.landmarkText,
    handoverOtpId: s.handoverOtpId,
    cashCollectedDiram: s.cashCollectedDiram?.diram ?? null,
    cashChangeDiram: s.cashChangeDiram?.diram ?? null,
    reassignReason: s.reassignReason,
    reassignedBy: s.reassignedBy,
    assignedAt: s.assignedAt,
    pickedUpFromPharmacyAt: s.pickedUpFromPharmacyAt,
    deliveredAt: s.deliveredAt,
    failedReason: s.failedReason,
    createdAt: s.createdAt,
    requiresColdChain: s.requiresColdChain,
    coldChainBagConfirmed: s.coldChainBagConfirmed,
    coldChainBagConfirmedAt: s.coldChainBagConfirmedAt,
    contactAttemptsCount: s.contactAttemptsCount,
    lastContactAttemptAt: s.lastContactAttemptAt,
    distanceMeters: s.distanceMeters,
    proofPhotoUrl: s.proofPhotoUrl,
  }
}

export const DELIVERY_ASSIGNMENT_REPOSITORY_PROVIDER = {
  provide: DELIVERY_ASSIGNMENT_REPOSITORY,
  useClass: DrizzleDeliveryAssignmentRepository,
} as const
