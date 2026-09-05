/**
 * `DeliveryAssignmentSnapshot` — plain-object состояние `DeliveryAssignment` (EP-13, DTJ-313),
 * тот же приём, что `modules/orders/domain/order-snapshot.ts` (C2 ≤300 строк/файл — вынесено из
 * `delivery-assignment.entity.ts`). Используется `restore()`/`toSnapshot()`; будущий Drizzle-маппер
 * (DTJ-314+) строит этот объект из строки `delivery_assignments`, домен о Drizzle не знает.
 */
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import type { DeliveryAssignmentStatus } from '@dorutj/contracts'

export interface DeliveryAssignmentSnapshot {
  readonly id: string
  readonly orderId: string
  readonly courierId: string | null
  readonly status: DeliveryAssignmentStatus
  readonly landmarkText: string | null
  readonly handoverOtpId: string | null
  readonly cashCollectedDiram: Money | null
  readonly cashChangeDiram: Money | null
  readonly reassignReason: string | null
  readonly reassignedBy: string | null
  readonly assignedAt: Date | null
  readonly pickedUpFromPharmacyAt: Date | null
  readonly deliveredAt: Date | null
  readonly failedReason: string | null
  readonly createdAt: Date
  readonly requiresColdChain: boolean
  readonly coldChainBagConfirmed: boolean | null
  readonly coldChainBagConfirmedAt: Date | null
  readonly contactAttemptsCount: number
  readonly lastContactAttemptAt: Date | null
  readonly distanceMeters: number | null
}
