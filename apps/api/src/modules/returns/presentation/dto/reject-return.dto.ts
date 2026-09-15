/**
 * `RejectReturnRequestSchema` (EP-11, DTJ-275) — тело `POST /api/v1/order-returns/:id/reject`.
 * `reason` обязателен (пустая строка — та же валидационная ошибка, что отсутствующее поле,
 * `422 VALIDATION_ERROR` через общий `ZodValidationPipe`, не серверная проверка постфактум).
 */
import { z } from 'zod'

export const RejectReturnRequestSchema = z.object({
  reason: z.string().min(1),
})

export type RejectReturnRequest = z.infer<typeof RejectReturnRequestSchema>
