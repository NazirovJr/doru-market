/**
 * `VerifyChainContactPhoneUseCase` (DTJ-064) — OTP-верификация контактного
 * телефона заявки сети. `subject_ref = chainId` (одна заявка — один телефон).
 *
 * Шаги:
 * 1. Загрузить `PharmacyChain` по `chainId` (404 если не найден).
 * 2. `otpPort.verifyCode({ phone: chain.contactPhone, code, purpose: 'onboarding_contact' })`
 *    — throws OtpMismatchError/OtpExpiredError.
 * 3. `chain.markContactPhoneVerified()` → сохранить.
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { type PharmacyChainRepositoryPort } from '../ports/pharmacy-chain.repository.port.js'
import { PHARMACY_CHAIN_REPOSITORY } from '../ports/pharmacy-chain.repository.port.js'
import { OTP_PORT, type OtpPort } from '../ports/otp.port.js'

export interface VerifyChainContactPhoneInput {
  readonly chainId: string
  readonly code: string
}

@Injectable()
export class VerifyChainContactPhoneUseCase {
  constructor(
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
    @Inject(OTP_PORT)
    private readonly otpPort: OtpPort,
  ) {}

  async execute(input: VerifyChainContactPhoneInput): Promise<{ id: string; verified: true }> {
    const chain = await this.pharmacyChainRepository.findById(input.chainId)
    if (chain === null) {
      throw new NotFoundError({ chainId: input.chainId })
    }
    await this.otpPort.verifyCode({
      phone: chain.contactPhone,
      code: input.code,
      purpose: 'onboarding_contact',
    })
    const verified = chain.markContactPhoneVerified()
    await this.pharmacyChainRepository.save(verified)
    return { id: verified.id, verified: true }
  }
}
