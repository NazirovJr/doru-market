import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { useAuthStore, type AuthSession } from '@/shared/api/auth-store'

/**
 * `use-verify-otp.ts` (DTJ-166) — портировано из `apps/web/src/features/auth/api/use-verify-otp.ts`
 * (EP-01, DTJ-028, `SRS-API-022/023/024`). ТОТ ЖЕ контракт `POST /api/v1/auth/otp/verify`:
 *   - input:  `{ otpRequestId: uuid, code: string (6 цифр) }`
 *   - 200:    `{ data: { accessToken, refreshToken, user: { id, role, tenantId, phoneNumber, fullName } } }`
 *   - 400:    `OTP_EXPIRED`, `OTP_MISMATCH`, `VALIDATION_ERROR`
 *   - 423:    `OTP_LOCKED` (6-я попытка)
 *
 * ВАЖНО (DTJ-166, критерий приёмки 4): этот эндпоинт РОЛЕ-АГНОСТИЧЕН — тот же контракт, что
 * `apps/web`/`apps/admin`. Бэкенд НЕ знает, что запрос пришёл из кабинета аптеки, и успешно
 * верифицирует `customer`/`courier` тоже. Отказ для неподходящей роли — ответственность
 * `LoginPage.tsx` (проверка `user.role` СРАЗУ после `onSuccess`, до навигации на `/inventory`) и
 * `shared/auth/auth-guard.tsx` (defense-in-depth). Здесь — только сохранение сессии, как в
 * `apps/web`, БЕЗ изменений логики этого хука.
 *
 * `retry: 0`: verify-код заведомо не повторится успешно за 1 ретрай, rate-limit-counters на бэке
 * уже инкрементированы.
 */

interface VerifyOtpRequest {
  readonly otpRequestId: string
  readonly code: string
}

interface VerifyOtpResponse {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: {
    readonly id: string
    readonly role: string
    readonly tenantId: string | null
    readonly phoneNumber: string | null
    readonly fullName: string | null
  }
}

export function useVerifyOtp(): UseMutationResult<
  VerifyOtpResponse,
  HttpError,
  VerifyOtpRequest
> {
  return useMutation<VerifyOtpResponse, HttpError, VerifyOtpRequest>({
    mutationKey: ['auth', 'verify-otp'],
    retry: 0,
    mutationFn: async (input: VerifyOtpRequest): Promise<VerifyOtpResponse> => {
      const response = await httpPostJson<VerifyOtpResponse>('/api/v1/auth/otp/verify', input)
      const session: AuthSession = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        user: response.user,
      }
      useAuthStore.getState().setSession(session)
      return response
    },
  })
}
