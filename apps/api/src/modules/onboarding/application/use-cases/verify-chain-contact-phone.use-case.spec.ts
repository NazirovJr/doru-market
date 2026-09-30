import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, OtpMismatchError } from '@dorutj/contracts'
import { PharmacyChain } from '@/modules/onboarding/domain/pharmacy-chain.entity.js'
import type { PharmacyChainRepositoryPort } from '../ports/pharmacy-chain.repository.port.js'
import type { OtpPort } from '../ports/otp.port.js'
import { VerifyChainContactPhoneUseCase } from './verify-chain-contact-phone.use-case.js'

const CHAIN_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const PHONE = '+992917123456'

function chain(): PharmacyChain {
  return PharmacyChain.create({
    id: CHAIN_ID,
    name: 'Test LLC',
    legalEntityName: 'Test LLC',
    tinInn: '123456789',
    directorFullName: 'Director',
    contactPhone: PHONE,
    legalAddress: null,
    isWhitelabelRequested: false,
  })
}

function build(stored: PharmacyChain | null, verifyCode: OtpPort['verifyCode']) {
  const save = vi.fn<PharmacyChainRepositoryPort['save']>(() => Promise.resolve())
  const repository = { findById: vi.fn(() => Promise.resolve(stored)), save } as unknown as PharmacyChainRepositoryPort
  const otp: OtpPort = { requestCode: vi.fn(), verifyCode }
  return { useCase: new VerifyChainContactPhoneUseCase(repository, otp), save }
}

describe('VerifyChainContactPhoneUseCase (DTJ-064)', () => {
  it('верный код: телефон помечен подтверждённым и сохранён; в OTP-порт уходит заявка, телефон и тенант', async () => {
    const verifyCode = vi.fn<OtpPort['verifyCode']>(() => Promise.resolve())
    const { useCase, save } = build(chain(), verifyCode)

    await expect(useCase.execute({ chainId: CHAIN_ID, code: '123456', tenantId: TENANT_ID })).resolves.toEqual({
      id: CHAIN_ID,
      verified: true,
    })

    expect(verifyCode).toHaveBeenCalledWith({ chainId: CHAIN_ID, phone: PHONE, tenantId: TENANT_ID, code: '123456' })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0].contactPhoneVerified).toBe(true)
  })

  it('неверный код: ошибка OTP пробрасывается, поле не меняется', async () => {
    const { useCase, save } = build(chain(), () => Promise.reject(new OtpMismatchError()))

    await expect(useCase.execute({ chainId: CHAIN_ID, code: '0000', tenantId: TENANT_ID })).rejects.toBeInstanceOf(
      OtpMismatchError,
    )
    expect(save).not.toHaveBeenCalled()
  })

  it('заявка не найдена: NotFoundError, OTP не проверяется', async () => {
    const verifyCode = vi.fn<OtpPort['verifyCode']>(() => Promise.resolve())
    const { useCase } = build(null, verifyCode)

    await expect(useCase.execute({ chainId: CHAIN_ID, code: '123456', tenantId: TENANT_ID })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect(verifyCode).not.toHaveBeenCalled()
  })
})
