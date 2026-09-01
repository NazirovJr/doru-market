/**
 * `OtpPort` (DTJ-064) — application-уровень контракт для отправки/верификации
 * одноразовых кодов. Локальная заглушка: реальный `OtpGeneratorPort`/`OtpRepository`
 * (EP-01 модуль `auth`) ещё не стабилизирован к моменту EP-03; здесь определён
 * УЗКИЙ порт с минимально необходимым контрактом для `VerifyChainContactPhoneUseCase`.
 *
 * Координация: `otp_purpose='onboarding_contact'` введён миграцией EP-03
 * (DTJ-063), готов к моменту реальной интеграции с EP-01.
 *
 * Когда EP-01 поставит стабильный `OtpGeneratorPort`, `OtpPort` ЗАМЕНЯЕТСЯ на
 * переиспользование того порта через `@/modules/auth` (правило `02` §1.2,
 * единый источник истины по OTP).
 */
export const OTP_PORT = Symbol.for('@dorutj/onboarding/otp-port')

export interface OtpPort {
  /**
   * Запрашивает отправку OTP-кода на указанный телефон с указанным purpose.
   * Возвращает детали доставки (для UI).
   */
  requestCode(input: { phone: string; purpose: 'onboarding_contact' }): Promise<{
    challengeId: string
    expiresAt: Date
  }>

  /**
   * Проверяет OTP-код. Бросает `OtpError`-семейство при ошибке
   * (OtpMismatchError, OtpExpiredError, OtpAttemptsExceededError).
   */
  verifyCode(input: { phone: string; code: string; purpose: 'onboarding_contact' }): Promise<void>
}
