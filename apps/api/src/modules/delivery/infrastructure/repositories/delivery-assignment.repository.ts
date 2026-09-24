/**
 * `DrizzleDeliveryAssignmentRepository` (EP-13, DTJ-314) — реализация
 * `DeliveryAssignmentRepositoryPort` поверх `delivery_assignments` (`db/schema/
 * delivery-assignments.ts`, DTJ-313). 1:1 паттерн `DrizzleSupportTicketsRepository` (upsert по
 * `id`, `resolveDrizzleClient` для tx-прозрачности).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, notInArray } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { deliveryAssignments, type DeliveryAssignmentRow } from '@/db/schema/delivery-assignments.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { DeliveryAssignment } from '@/modules/delivery/domain/delivery-assignment.entity.js'
import type { DeliveryAssignmentSnapshot } from '@/modules/delivery/domain/delivery-assignment-snapshot.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  TERMINAL_DELIVERY_ASSIGNMENT_STATUSES,
  type DeliveryAssignmentRepositoryPort,
} from '@/modules/delivery/application/ports/delivery-assignment.repository.port.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

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

  /** ДОБАВЛЕНО DTJ-321 — см. JSDoc порта (`findActiveByOrderId` непригоден для терминальных назначений). */
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
  }
}

export const DELIVERY_ASSIGNMENT_REPOSITORY_PROVIDER = {
  provide: DELIVERY_ASSIGNMENT_REPOSITORY,
  useClass: DrizzleDeliveryAssignmentRepository,
} as const
