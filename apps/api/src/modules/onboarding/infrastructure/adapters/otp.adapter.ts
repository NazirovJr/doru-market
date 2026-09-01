/**
 * `StubOtpAdapter` (DTJ-064) — заглушка `OtpPort` для development-среды.
 *
 * ВНИМАНИЕ: это ЗАГЛУШКА. Реальный OTP-механизм (модуль `auth`, EP-01)
 * переиспользуется через `@/modules/auth` после готовности того эпика.
 * До тех пор адаптер:
 * - `requestCode` возвращает фиксированный `challengeId` без реальной отправки SMS.
 * - `verifyCode` принимает ТОЛЬКО код `0000` (тестовая договорённость).
 *
 * В production-сборке ЗАМЕНЯЕТСЯ реальным адаптером `auth` модуля (TODO(EP-01)).
 */
import { Injectable } from '@nestjs/common'
import { OtpMismatchError } from '@dorutj/contracts'
import type { OtpPort } from '@/modules/onboarding/application/ports/otp.port.js'

/** 4-значный тестовый код, принимаемый заглушкой. */
const STUB_ACCEPTED_CODE = '0000'
/** TTL OTP-кода в минутах (стандартная длительность сессии OTP-кода в dev-режиме). */
const OTP_TTL_MINUTES = 5
const MS_PER_MINUTE = 60_000

@Injectable()
export class StubOtpAdapter implements OtpPort {
  requestCode(input: { phone: string; purpose: 'onboarding_contact' }): Promise<{
    challengeId: string
    expiresAt: Date
  }> {
    void input
    return Promise.resolve({
      challengeId: `stub-challenge-${String(Date.now())}`,
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * MS_PER_MINUTE),
    })
  }

  verifyCode(input: { phone: string; code: string; purpose: 'onboarding_contact' }): Promise<void> {
    if (input.code !== STUB_ACCEPTED_CODE) {
      return Promise.reject(new OtpMismatchError({ field: 'code' }))
    }
    return Promise.resolve()
  }
}
