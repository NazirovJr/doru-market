import { Inject, Injectable } from '@nestjs/common'
import { isErr } from '@dorutj/domain-kernel'
import { RequestOtpUseCase, VerifyOtpUseCase } from '@/modules/auth/index.js'
import type { ContactOtpTarget, OtpPort } from '@/modules/onboarding/application/ports/otp.port.js'

const MS_PER_SECOND = 1000

// Код привязан к паре «заявка + телефон»: смена телефона заявки обесценивает выданный код.
function contactSubjectRef(target: ContactOtpTarget): string {
  return `${target.chainId}:${target.phone}`
}

@Injectable()
export class AuthOtpAdapter implements OtpPort {
  constructor(
    @Inject(RequestOtpUseCase) private readonly requestOtp: RequestOtpUseCase,
    @Inject(VerifyOtpUseCase) private readonly verifyOtp: VerifyOtpUseCase,
  ) {}

  async requestCode(input: ContactOtpTarget & { readonly ipAddress: string }): Promise<{
    challengeId: string
    expiresAt: Date
  }> {
    const issued = await this.requestOtp.execute({
      phone: input.phone,
      ipAddress: input.ipAddress,
      tenantId: input.tenantId,
      purpose: 'onboarding_contact',
      subjectRef: contactSubjectRef(input),
    })
    return {
      challengeId: issued.otpRequestId,
      expiresAt: new Date(Date.now() + issued.expiresInSeconds * MS_PER_SECOND),
    }
  }

  async verifyCode(input: ContactOtpTarget & { readonly code: string }): Promise<void> {
    const result = await this.verifyOtp.verifyContactCode({
      tenantId: input.tenantId,
      subjectRef: contactSubjectRef(input),
      purpose: 'onboarding_contact',
      code: input.code,
    })
    if (isErr(result)) {
      throw result.error
    }
  }
}
