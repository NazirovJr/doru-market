/**
 * `AddMessageSchema` (EP-14, DTJ-282) — `POST /api/v1/support-tickets/:id/messages` body.
 * `body` — непустая строка после trim (домен `SupportTicketMessage.create()` уже валидирует то
 * же самое, DTJ-278, но ранняя Zod-проверка даёт чистый `400 VALIDATION_ERROR` до похода в use
 * case — тот же приём, что дублирование валидации email/phone на границе HTTP в auth-модуле).
 */
import { z } from 'zod'

const MIN_BODY_LENGTH = 1

export const AddMessageSchema = z.object({
  body: z.string().trim().min(MIN_BODY_LENGTH),
})

export type AddMessageDto = z.infer<typeof AddMessageSchema>
