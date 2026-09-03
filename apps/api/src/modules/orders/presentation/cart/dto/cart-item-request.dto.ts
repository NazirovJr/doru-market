/**
 * `cart-item-request.dto.ts` (EP-09, DTJ-226) — Zod-схемы тел запросов для
 * `POST /api/v1/cart/items` и `PATCH /api/v1/cart/items/:id`. Локальные для presentation
 * этого модуля (не `@dorutj/contracts`, в отличие от, например, `PharmacyMapQuerySchema`) —
 * ticket называет ИМЕННО этот путь в `files_owned`, схема не пересекает границу процесса
 * (не нужна другим сервисам/OpenAPI-клиенту отдельно от REST-контракта этого эндпоинта).
 *
 * `CartItemQuantityRequestSchema` НЕ требует `.positive()` (в отличие от
 * `CartItemRequestSchema`) — SRS-ORD-013: `quantity <= 0` в `PATCH` валиден и эквивалентен
 * `DELETE` (`UpdateCartItemQuantityUseCase`, DTJ-223), это не ошибка валидации формы.
 */
import { z } from 'zod'

export const CartItemRequestSchema = z.object({
  medicineId: z.uuid(),
  pharmacyId: z.uuid(),
  quantity: z.number().int().positive(),
})
export type CartItemRequestDto = z.infer<typeof CartItemRequestSchema>

export const CartItemQuantityRequestSchema = z.object({
  quantity: z.number().int(),
})
export type CartItemQuantityRequestDto = z.infer<typeof CartItemQuantityRequestSchema>
