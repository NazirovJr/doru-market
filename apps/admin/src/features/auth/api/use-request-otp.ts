import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'

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
