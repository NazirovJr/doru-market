/**
 * `MarkInTransitRequestSchema` (EP-11, DTJ-275) — тело `POST /api/v1/order-returns/:id/mark-in-transit`
 * и `POST /api/v1/order-returns/:id/retry-transit` (та же форма — оба назначают курьера обратного
 * рейса, см. `MarkReturnInTransitCommand`/`RetryReturnTransitCommand`).
 */
import { z } from 'zod'

export const MarkInTransitRequestSchema = z.object({
  courierId: z.uuid(),
})

export type MarkInTransitRequest = z.infer<typeof MarkInTransitRequestSchema>
