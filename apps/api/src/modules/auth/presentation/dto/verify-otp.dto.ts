/**
 * Zod-схема + Zod-тип `verify-otp.dto.ts` (EP-01, DTJ-024).
 *
 * Контракт: `{ otpRequestId: uuid, code: 6 цифр }` (DTJ-024 §«Что сделать» п.2).
 *
 * `phone` НЕ принимается — `phoneNumber` восстанавливается в use case
 * из `otp_codes.subject_ref` (DTJ-024 §3.5, защита от подмены номера
 * между `request` и `verify`).
 */
import { z } from 'zod'
import { OTP_CODE_LENGTH } from '@/modules/auth/application/use-cases/verify-otp.use-case.js'

export const verifyOtpDtoSchema = z.object({
  otpRequestId: z.uuid('otpRequestId должен быть валидным UUID'),
  code: z.string().length(OTP_CODE_LENGTH, `code должен содержать ${String(OTP_CODE_LENGTH)} цифр`),
})

export type VerifyOtpDto = z.infer<typeof verifyOtpDtoSchema>
