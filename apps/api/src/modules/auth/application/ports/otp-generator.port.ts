/**
 * `OtpGeneratorPort` (EP-01, DTJ-010, SRS-DOM-081) — генератор одноразовых кодов.
 *
 * Чистый порт: детали генерации (cryptographically-secure) — в адаптере
 * (`infrastructure/adapters/crypto-otp-generator.adapter.ts`). `purpose` —
 * логическое назначение (`'login'` для EP-01, `'onboarding_contact'` для EP-03
 * через `OtpPort`-адаптер). Сам факт существования этого порта означает, что
 * use case'ы НЕ вызывают `Math.random()`/`crypto.randomBytes()` напрямую.
 */
export const OTP_GENERATOR = Symbol.for('@dorutj/auth/otp-generator')

/**
 * ДОБАВЛЕНО (DTJ-305, EP-12 §A.5, SRS-DOM-080) — `'delivery_handover'`: OTP вручения заказа
 * курьером клиенту, генерируется `CompletePickingUseCase` (`modules/orders`) ЧЕРЕЗ этот же порт
 * (межмодульное переиспользование — тот же приём, что `JWT_SIGNER`, реэкспортирован
 * `auth/index.ts`), 4 цифры вместо 6 у `'login'` (см. `CryptoOtpGeneratorAdapter`/
 * `HANDOVER_OTP_CODE_LENGTH`).
 */
export type OtpPurpose = 'login' | 'onboarding_contact' | 'delivery_handover'

export interface OtpGeneratorPort {
  /** Возвращает сырой код (например, `'847293'`) и его криптографически-стойкий хеш. */
  generate(purpose: OtpPurpose): { readonly code: string; readonly codeHash: string }
}
