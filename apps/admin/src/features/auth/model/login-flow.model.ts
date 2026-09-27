// Тот же reducer, что apps/pharmacy/src/features/auth/model/login-flow.model.ts (DTJ-166/434):
// вне React/Query, только состояние и переходы шагов OTP-входа.

export const MAX_VERIFY_ATTEMPTS = 5

export type LoginStep = 'phone' | 'code' | 'locked'

export interface LoginFlowState {
  readonly step: LoginStep
  readonly phone: string
  readonly otpRequestId: string | null
  readonly attemptsLeft: number
  readonly resendCooldownSeconds: number
  readonly errorCode: string | null
}

export type LoginFlowEvent =
  | { readonly type: 'phoneSubmit'; readonly phone: string; readonly otpRequestId: string }
  | { readonly type: 'codeMismatch' }
  | { readonly type: 'codeExpired' }
  | { readonly type: 'codeLocked' }
  | { readonly type: 'codeSuccess' }
  | { readonly type: 'resendRequested' }
  | { readonly type: 'tick'; readonly now: Date }
  | { readonly type: 'goBackToPhone' }

const RESEND_COOLDOWN_SECONDS = 60

export const initialState: LoginFlowState = {
  step: 'phone',
  phone: '',
  otpRequestId: null,
  attemptsLeft: MAX_VERIFY_ATTEMPTS,
  resendCooldownSeconds: 0,
  errorCode: null,
}

export function loginFlowReducer(state: LoginFlowState, event: LoginFlowEvent): LoginFlowState {
  switch (event.type) {
    case 'phoneSubmit':
      return {
        ...state,
        step: 'code',
        phone: event.phone,
        otpRequestId: event.otpRequestId,
        attemptsLeft: MAX_VERIFY_ATTEMPTS,
        resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
        errorCode: null,
      }
    case 'codeMismatch':
      return { ...state, step: 'code', attemptsLeft: Math.max(0, state.attemptsLeft - 1), errorCode: 'OTP_MISMATCH' }
    case 'codeExpired':
      return { ...state, step: 'code', errorCode: 'OTP_EXPIRED' }
    case 'codeLocked':
      return { ...state, step: 'locked', attemptsLeft: 0, errorCode: 'OTP_LOCKED' }
    case 'codeSuccess':
      return { ...state, step: 'code', errorCode: null }
    case 'resendRequested':
      return { ...state, step: 'phone', otpRequestId: null, attemptsLeft: MAX_VERIFY_ATTEMPTS, resendCooldownSeconds: 0, errorCode: null }
    case 'goBackToPhone':
      return { ...state, step: 'phone', otpRequestId: null, attemptsLeft: MAX_VERIFY_ATTEMPTS, resendCooldownSeconds: 0, errorCode: null }
    case 'tick':
      if (state.resendCooldownSeconds <= 0) {
        return state
      }
      return { ...state, resendCooldownSeconds: state.resendCooldownSeconds - 1 }
  }
}

export function errorCodeToI18nKey(
  code: string | null,
): { key: string; params: Readonly<Record<string, string | number>> } | null {
  switch (code) {
    case 'OTP_MISMATCH':
      return { key: 'ux.error.otp_mismatch', params: { attemptsLeft: 0 } }
    case 'OTP_EXPIRED':
      return { key: 'ux.error.otp_expired', params: {} }
    case 'OTP_LOCKED':
      return { key: 'ux.error.otp_locked', params: {} }
    case 'OTP_REQUEST_RATE_LIMITED':
      return { key: 'ux.error.otp_locked', params: {} }
    case 'INVALID_PHONE_FORMAT':
      return { key: 'ux.error.generic_500', params: {} }
    default:
      return code === null ? null : { key: 'ux.error.generic_500', params: {} }
  }
}
