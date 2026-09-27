import { z } from 'zod'
import { cursorQuerySchema } from '../pagination.js'
import { ORDER_STATUS_VALUES } from '../orders.js'

// z.preprocess, не z.coerce.boolean() — та коэрсия сделала бы строку 'false' истинной.
function normalizeBooleanQueryValue(value: unknown): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

export const OrdersAdminListQuerySchema = cursorQuerySchema.extend({
  scope: z.literal('own').optional(),
  'filter[orderNumber]': z.string().trim().min(1).optional(),
  'filter[status]': z.enum(ORDER_STATUS_VALUES).optional(),
  'filter[tenantId]': z.uuid().optional(),
  'filter[pharmacyId]': z.uuid().optional(),
  'filter[customerId]': z.uuid().optional(),
  'filter[createdAt][from]': z.coerce.date().optional(),
  'filter[createdAt][to]': z.coerce.date().optional(),
  'filter[slaBreached]': z.preprocess(normalizeBooleanQueryValue, z.boolean().optional()),
})
export type OrdersAdminListQueryDto = z.infer<typeof OrdersAdminListQuerySchema>

export interface OrderAdminSummaryDto {
  readonly id: string
  readonly orderNumber: string
  readonly status: string
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly customerId: string
  readonly paymentMethod: string
  readonly totalAmountDiram: number
  readonly slaBreached: boolean
  readonly createdAt: string
}

export interface OrderTimelineDto {
  readonly createdAt: string
  readonly processingStartedAt: string | null
  readonly pickedUpAt: string | null
  readonly deliveredAt: string | null
  readonly slaDeadlineAt: string | null
  readonly cancelReason: string | null
  readonly updatedAt: string
}

export interface OrderAdminEscrowLedgerEntryDto {
  readonly orderId: string
  readonly entryType: string
  readonly direction: string
  readonly amountDiram: number
  readonly reason: string | null
  readonly actorUserId: string | null
  readonly paymentTransactionRef: string | null
  readonly createdAt: string
}

export interface OrderAdminPayoutScheduleDto {
  readonly orderId: string
  readonly orderNumber: string
  readonly pharmacyId: string
  readonly grossAmountDiram: number
  readonly commissionDiram: number
  readonly netAmountDiram: number
  readonly status: string
  readonly dueAt: string | null
  readonly paidAt: string | null
}

export interface OrderAdminPrescriptionMetaDto {
  readonly prescriptionId: string
  readonly status: string
}

export interface OrderDetailAdminDto {
  readonly id: string
  readonly orderNumber: string
  readonly status: string
  readonly tenantId: string
  readonly pharmacyId: string
  readonly customerId: string
  readonly paymentMethod: string
  readonly totalAmountDiram: number
  readonly prescriptionId: string | null
  readonly createdAt: string
  readonly timeline: OrderTimelineDto
  // null — эскроу не применяется (cash_courier), не пустая таблица.
  readonly escrowLedger: readonly OrderAdminEscrowLedgerEntryDto[] | null
  readonly payoutSchedule: OrderAdminPayoutScheduleDto | null
  readonly prescriptionMeta: OrderAdminPrescriptionMetaDto | null
}
