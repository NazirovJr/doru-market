/**
 * `CryptoOtpGeneratorAdapter` (EP-01, DTJ-010) — production-реализация `OtpGeneratorPort`.
 *
 * Использует `crypto.randomInt(0, 10^LENGTH)` для каждой цифры, чтобы избежать
 * modulo-bias. Длина кода — `OTP_CODE_LENGTH` (6, SRS-API-022) для `'login'`/
 * `'onboarding_contact'`; `HANDOVER_OTP_CODE_LENGTH` (4, SRS-DOM-080, ДОБАВЛЕНО DTJ-305) для
 * `'delivery_handover'`. Хеш — `sha256(code + ':' + subjectRef)` через `node:crypto`
 * (SRS-API-021, subjectRef передаётся генератору; для login — это `phone.value`).
 */
import { Injectable } from '@nestjs/common'
import { createHash, randomInt } from 'node:crypto'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import { HANDOVER_OTP_CODE_LENGTH, OTP_CODE_LENGTH } from '@/modules/auth/domain/value-objects/otp-code.vo.js'
import { OTP_GENERATOR, type OtpGeneratorPort, type OtpPurpose } from '@/modules/auth/application/ports/otp-generator.port.js'

const DIGIT_BASE = 10
const SHA256_HEX_LENGTH = 64

@Injectable()
export class CryptoOtpGeneratorAdapter implements OtpGeneratorPort {
  generate(purpose: OtpPurpose): { readonly code: string; readonly codeHash: string } {
    const length = purpose === 'delivery_handover' ? HANDOVER_OTP_CODE_LENGTH : OTP_CODE_LENGTH
    const code = generateDigitCode(length)
    // subjectRef на этом этапе не нужен: `codeHash` для логина
    // (`purpose='login'`) вычисляется в `RequestOtpUseCase` как
    // `sha256(code + otpRequestId)` — `otpRequestId` (UUID) выступает
    // солью (SRS-API-021). Этот адаптер возвращает хеш БЕЗ соли —
    // use case ОБЯЗАН перехэшировать перед записью в БД. Здесь оставляем
    // sha256(code) для совместимости сигнатуры порта (используется при
    // eventual verify в R2, когда `codeHash` сравнивается напрямую).
    const codeHash = createHash('sha256').update(code).digest('hex').slice(0, SHA256_HEX_LENGTH)
    return { code, codeHash }
  }
}

function generateDigitCode(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += String(randomInt(0, DIGIT_BASE))
  }
  return out
}

export { OTP_GENERATOR }
