// DTJ-356 — payment-override/admin-force-cancel (SRS-ADM-032/033). `reason.min(10)` — содержательное
// объяснение (см. AC1 тикета), не только непустая строка.
import { z } from 'zod'

const REASON_MIN_LENGTH = 10

export const AdminPaymentOverrideBodySchema = z.object({
  reason: z.string().trim().min(REASON_MIN_LENGTH),
  // Банковское подтверждение, которое реально требует домен (DTJ-246) — см. JSDoc use case.
  txId: z.string().min(1),
  amountDiram: z.coerce.bigint().positive(),
  paidAt: z.iso.datetime(),
})
export type AdminPaymentOverrideBodyDto = z.infer<typeof AdminPaymentOverrideBodySchema>

export interface AdminPaymentOverrideResultDto {
  readonly orderId: string
  readonly status: string
}

export const AdminForceCancelOrderBodySchema = z.object({
  reason: z.string().trim().min(REASON_MIN_LENGTH),
})
export type AdminForceCancelOrderBodyDto = z.infer<typeof AdminForceCancelOrderBodySchema>

export interface AdminForceCancelOrderResultDto {
  readonly orderId: string
  readonly status: string
  readonly refundIssued: boolean
}
