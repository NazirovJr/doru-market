import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { useAuthStore, type AuthSession } from '@/shared/api/auth-store'

/**
 * `use-verify-otp.ts` (EP-01, DTJ-028, SRS-API-022/023/024) — TanStack
 * Query мутация поверх `httpPostJson('/api/v1/auth/otp/verify', ...)`.
 *
 * Контракт (бэкенд DTJ-024, OtpVerifyController):
 *   - input:  `{ otpRequestId: uuid, code: string (6 цифр) }`
 *   - 200:    `{ data: { accessToken, refreshToken, user: { id, role, tenantId, phoneNumber, fullName } } }`
 *   - 400:    `OTP_EXPIRED`, `OTP_MISMATCH`, `VALIDATION_ERROR` (Zod)
 *   - 423:    `OTP_LOCKED` (6-я попытка)
 *   - 500:    `INTERNAL_ERROR`
 *
 * На УСПЕХЕ вызывает `useAuthStore.setSession({ accessToken, refreshToken, user })`
 * — refresh персистится в `localStorage` (DTJ-028).
 *
 * БЕЗ ретраев (`retry: 0`): verify-код заведомо не повторится успешно
 * за 1 ретрай, а rate-limit-counters на бэке уже инкрементированы.
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
