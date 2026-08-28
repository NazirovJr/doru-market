/**
 * Детерминированный тест-дублёр порта `OtpGeneratorPort` (`docs/spec/10-domain-model.md` §2.6).
 * `SRS-NFR-030` п.3: возвращает заранее известный код по назначению (`purpose`) — E2E-тест
 * вводит именно это значение, не читает случайное.
 */

export type OtpPurpose = 'login' | 'handover'

/** Дефолтный код для входа по OTP (`SRS-NFR-030` п.3). */
const DEFAULT_LOGIN_CODE = '483920'
/** Дефолтный код передачи заказа курьером (`SRS-NFR-030` п.3). */
const DEFAULT_HANDOVER_CODE = '1234'

export interface FixedOtpGeneratorOptions {
  loginCode?: string
  handoverCode?: string
}

export class FixedOtpGeneratorAdapter {
  private readonly loginCode: string
  private readonly handoverCode: string

  constructor(options: FixedOtpGeneratorOptions = {}) {
    this.loginCode = options.loginCode ?? DEFAULT_LOGIN_CODE
    this.handoverCode = options.handoverCode ?? DEFAULT_HANDOVER_CODE
  }

  generate(purpose: OtpPurpose): string {
    return purpose === 'login' ? this.loginCode : this.handoverCode
  }
}
