/**
 * Zod-схема `RequestOtpDto` (EP-01, DTJ-023).
 *
 * Минимальная DTO: только `phone`. Валидация ФОРМАТА делегируется
 * `PhoneNumber.parse` внутри use case (SRS-API-020) — НЕ в Zod-регэкспе,
 * чтобы правило формата имело ОДИН источник (`PhoneNumber`, DTJ-008).
 *
 * `ZodValidationPipe` (apps/api/src/common/validation/zod-validation.pipe.ts) —
 * единая точка применения Zod-схем к входящим запросам, не пишем свой pipe.
 */
import { z } from 'zod'

export const requestOtpDtoSchema = z.object({
  phone: z.string().min(1, 'phone is required'),
})

export type RequestOtpDto = z.infer<typeof requestOtpDtoSchema>
