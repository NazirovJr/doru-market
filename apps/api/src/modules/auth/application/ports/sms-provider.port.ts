/**
 * `SmsProviderPort` (EP-01, DTJ-023, Charter §3.3 Provider Pattern) — отправка OTP.
 *
 * Реализации:
 *   - `MockSmsProviderAdapter` — пишет код в pino-лог (если `NODE_ENV !== 'production'`)
 *     и/или в ответ эндпоинта (если `MOCK_SMS_EXPOSE_CODE_IN_RESPONSE=true` для E2E);
 *   - `SmsGatewayProvider` — реальная интеграция (R2 или когда появится провайдер).
 *
 * Сырой код передаётся ТОЛЬКО в `sendOtp` и забывается сразу после вызова — use case
 * не персистирует его (SRS-API-021).
 */
import { type PhoneNumber } from '../../domain/value-objects/phone-number.vo.js'
import { type OtpPurpose } from './otp-generator.port.js'

export const SMS_PROVIDER = Symbol.for('@dorutj/auth/sms-provider')

export interface SmsProviderPort {
  /**
   * @param phone  — E.164 номер (нормализован `PhoneNumber.parse`).
   * @param code   — сырой OTP-код (4-8 цифр), виден только в стеке вызова.
   * @param purpose — логическое назначение (для текста SMS).
   */
  sendOtp(phone: PhoneNumber, code: string, purpose: OtpPurpose): Promise<void>
}
