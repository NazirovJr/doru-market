/**
 * Zod-схема + Zod-тип `logout.dto.ts` (EP-01, DTJ-026).
 *
 * Контракт: `{ refreshToken: string }` — opaque refresh-токен, выданный
 * `VerifyOtpUseCase` (DTJ-024) или предыдущим `RefreshTokenUseCase`
 * (DTJ-025). Аналогично `refresh.dto.ts` — минимальная валидация
 * (непустая строка), сам формат opaque проверяется через
 * `sha256(refreshToken)` → `findByRefreshHash`.
 */
import { z } from 'zod'

export const logoutDtoSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
})

export type LogoutDto = z.infer<typeof logoutDtoSchema>
