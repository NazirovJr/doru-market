import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'

/**
 * `use-request-otp.ts` (DTJ-166) — портировано из `apps/web/src/features/auth/api/use-request-otp.ts`
 * (EP-01, DTJ-028, `SRS-API-018/020`). ТОТ ЖЕ контракт `POST /api/v1/auth/otp/request`:
 *   - input:  `{ phone: string }`
 *   - 202:    `{ data: { otpRequestId: uuid, expiresInSeconds: 300 } }`
 *   - 400:    `INVALID_PHONE_FORMAT`
 *   - 429:    `OTP_REQUEST_RATE_LIMITED`
 *
 * `retry: 0` — повторять запрос кода бессмысленно (rate-limit-окно уже тикает).
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
