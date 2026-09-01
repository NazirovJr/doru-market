import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'

/**
 * `use-request-otp.ts` (EP-01, DTJ-028, SRS-API-018/020) — TanStack
 * Query мутация поверх `httpPostJson('/api/v1/auth/otp/request', ...)`.
 *
 * Контракт (бэкенд DTJ-023, OtpRequestController):
 *   - input:  `{ phone: string }`
 *   - 202:    `{ data: { otpRequestId: uuid, expiresInSeconds: 300 } }`
 *   - 400:    `INVALID_PHONE_FORMAT` (Zod или PhoneNumber.parse)
 *   - 429:    `OTP_REQUEST_RATE_LIMITED` (4 независимых лимита)
 *
 * Мутация НЕ делает ретраи (`retry: 0`) — повторять запрос кода бессмысленно
 * (rate-limit-окно уже тикает), и пользователь только что сам нажал кнопку.
 * `mutationKey` — `['auth', 'request-otp']`, чтобы TanStack Query Devtools
 * отличал её от verify-mutation.
 */

interface RequestOtpRequest {
  readonly phone: string
}

interface RequestOtpResponse {
  readonly otpRequestId: string
  readonly expiresInSeconds: number
}

export function useRequestOtp(): UseMutationResult<RequestOtpResponse, HttpError, RequestOtpRequest> {
  return useMutation<RequestOtpResponse, HttpError, RequestOtpRequest>({
    mutationKey: ['auth', 'request-otp'],
    retry: 0,
    mutationFn: async (input: RequestOtpRequest): Promise<RequestOtpResponse> => {
      return httpPostJson<RequestOtpResponse>('/api/v1/auth/otp/request', input)
    },
  })
}
