/**
 * `OtpPort` — контракт onboarding на отправку и проверку OTP контактного телефона заявки сети
 * (`purpose = 'onboarding_contact'`). Реализация делегирует OTP-механизму модуля `auth`.
 */
export const OTP_PORT = Symbol.for('@dorutj/onboarding/otp-port')

export interface ContactOtpTarget {
  readonly chainId: string
  readonly phone: string
  readonly tenantId: string
}

export interface OtpPort {
  requestCode(input: ContactOtpTarget & { readonly ipAddress: string }): Promise<{
    challengeId: string
    expiresAt: Date
  }>

  /** Бросает `OtpError`-семейство (`OtpMismatchError`, `OtpExpiredError`, `OtpAttemptsExceededError`). */
  verifyCode(input: ContactOtpTarget & { readonly code: string }): Promise<void>
}
