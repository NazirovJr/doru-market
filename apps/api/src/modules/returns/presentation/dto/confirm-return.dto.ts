/**
 * `ConfirmReturnRequestSchema` (EP-11, DTJ-275) — тело `POST /api/v1/order-returns/:id/confirm`.
 * 1:1 с `ConfirmReceivedChecklist` (`domain/order-return.entity.ts`).
 */
import { z } from 'zod'

export const ConfirmReturnRequestSchema = z.object({
  checklist: z.object({
    packagingIntact: z.boolean(),
    notes: z.string().optional(),
  }),
})

export type ConfirmReturnRequest = z.infer<typeof ConfirmReturnRequestSchema>
