/**
 * Zod-схема + Zod-тип `refresh.dto.ts` (EP-01, DTJ-025, SRS-API-026).
 *
 * Контракт: `{ refreshToken: string }` — opaque refresh-токен, выданный
 * ранее `VerifyOtpUseCase` (DTJ-024) или предыдущим `RefreshTokenUseCase`.
 *
 * Минимальная валидация: токен — непустая строка. Сам формат opaque
 * (base64url 32 байта) проверяется ПОСЛЕ попытки найти строку
 * `auth_sessions` по `sha256(token)` (DTJ-025 §2.1) — невалидный base64
 * просто даст несуществующий хеш → `RefreshTokenInvalidError`, тот же
 * ответ, что и для истёкшего/несуществующего токена (SRS-API-028:
 * «не раскрывать причину подробнее»).
 */
import { z } from 'zod'

export const refreshDtoSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
})

export type RefreshDto = z.infer<typeof refreshDtoSchema>
