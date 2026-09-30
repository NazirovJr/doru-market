import { describe, expect, it, vi } from 'vitest'
import { OtpMismatchError } from '@dorutj/contracts'
import { err, ok } from '@dorutj/domain-kernel'
import type { RequestOtpUseCase, VerifyOtpUseCase } from '@/modules/auth/index.js'
import { AuthOtpAdapter } from './auth-otp.adapter.js'

const TARGET = { chainId: 'chain-1', phone: '+992917123456', tenantId: 'tenant-1' }

function build(verifyResult: Awaited<ReturnType<VerifyOtpUseCase['verifyContactCode']>> = ok(undefined)) {
  const execute = vi.fn(() => Promise.resolve({ otpRequestId: 'otp-1', expiresInSeconds: 300 }))
  const verifyContactCode = vi.fn(() => Promise.resolve(verifyResult))
  const adapter = new AuthOtpAdapter(
    { execute } as unknown as RequestOtpUseCase,
    { verifyContactCode } as unknown as VerifyOtpUseCase,
  )
  return { adapter, execute, verifyContactCode }
}

describe('AuthOtpAdapter (DTJ-064)', () => {
  it('requestCode: делегирует auth с purpose onboarding_contact и subjectRef «заявка:телефон»', async () => {
    const { adapter, execute } = build()

    const issued = await adapter.requestCode({ ...TARGET, ipAddress: '10.0.0.1' })

    expect(execute).toHaveBeenCalledWith({
      phone: TARGET.phone,
      ipAddress: '10.0.0.1',
      tenantId: TARGET.tenantId,
      purpose: 'onboarding_contact',
      subjectRef: 'chain-1:+992917123456',
    })
    expect(issued.challengeId).toBe('otp-1')
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('verifyCode: успех auth — без ошибки, тот же subjectRef', async () => {
    const { adapter, verifyContactCode } = build()

    await expect(adapter.verifyCode({ ...TARGET, code: '123456' })).resolves.toBeUndefined()

    expect(verifyContactCode).toHaveBeenCalledWith({
      tenantId: TARGET.tenantId,
      subjectRef: 'chain-1:+992917123456',
      purpose: 'onboarding_contact',
      code: '123456',
    })
  })

  it('verifyCode: ошибка auth пробрасывается как есть', async () => {
    const { adapter } = build(err(new OtpMismatchError()))

    await expect(adapter.verifyCode({ ...TARGET, code: '0000' })).rejects.toBeInstanceOf(OtpMismatchError)
  })
})
