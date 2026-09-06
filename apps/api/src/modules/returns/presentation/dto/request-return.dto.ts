/**
 * `RequestReturnRequestSchema` (EP-11, DTJ-275) — тело `POST /api/v1/order-returns`. 1:1 с
 * `RequestReturnCommand` (`application/use-cases/request-return.use-case.ts`), кроме полей,
 * резолвимых presentation-слоем (`tenantId`/`initiatorId`/`initiatorRole` — из `JwtClaims`).
 */
import { z } from 'zod'
import { RETURN_REASON_VALUES } from '@dorutj/contracts'

export const RequestReturnRequestSchema = z.object({
  orderId: z.uuid(),
  reason: z.enum(RETURN_REASON_VALUES),
})

export type RequestReturnRequest = z.infer<typeof RequestReturnRequestSchema>
