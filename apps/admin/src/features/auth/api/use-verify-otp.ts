import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { useAuthStore, type AuthSession } from '@/shared/auth/auth-store'

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

// Эндпоинт роле-агностичен (см. shared/auth/auth-guard.tsx) — отказ неподходящей роли делает
// LoginPage сразу после успеха, до навигации.
export function useVerifyOtp(): UseMutationResult<VerifyOtpResponse, HttpError, VerifyOtpRequest> {
  return useMutation<VerifyOtpResponse, HttpError, VerifyOtpRequest>({
    mutationKey: ['auth', 'verify-otp'],
    retry: 0,
    mutationFn: async (input: VerifyOtpRequest): Promise<VerifyOtpResponse> => {
      const response = await httpPostJson<VerifyOtpResponse>('/api/v1/auth/otp/verify', input)
      const session: AuthSession = { accessToken: response.accessToken, refreshToken: response.refreshToken, user: response.user }
      useAuthStore.getState().setSession(session)
      return response
    },
  })
}
