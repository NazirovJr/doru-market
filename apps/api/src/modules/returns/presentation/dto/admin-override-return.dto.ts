/**
 * `AdminOverrideReturnRequestSchema` (EP-11, DTJ-275) — тело `POST /api/v1/order-returns/:id/admin-override`.
 * `reason` обязателен — зеркалит `order_returns.admin_override_reason NOT NULL` (REQ-RET-9,
 * см. `OrderReturn.adminOverride`).
 */
import { z } from 'zod'

export const AdminOverrideReturnRequestSchema = z.object({
  reason: z.string().min(1),
})

export type AdminOverrideReturnRequest = z.infer<typeof AdminOverrideReturnRequestSchema>
