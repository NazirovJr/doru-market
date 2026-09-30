import { describe, expect, it } from 'vitest'
import { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import type { OnboardingStatus } from '@/modules/onboarding/domain/value-objects/onboarding-status.vo.js'
import type { PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { PharmacyChainStatusPort } from '@/modules/onboarding/application/ports/pharmacy-chain-status.port.js'
import type { PharmacyVerificationRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import type { OnboardingReviewLogRepositoryPort } from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'
import { ReviewPharmacyApplicationUseCase } from './review-pharmacy-application.use-case.js'

const PHARMACY_ID = '11111111-1111-4111-8111-111111111111'
const CHAIN_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'
const LICENSE_EXPIRY = new Date('2030-01-01')

function pendingAccount(): PharmacyAccount {
  const draft = PharmacyAccount.create({
    id: PHARMACY_ID,
    chainId: CHAIN_ID,
    name: 'Test',
    addressText: 'Dushanbe',
    latitude: 38.5,
    longitude: 68.7,
    phone: '+992900000001',
    licenseNumber: 'L-1',
    licenseExpiryDate: LICENSE_EXPIRY,
  })
  return draft.submitForReview(new Date())
}

function build(chainStatus: OnboardingStatus | null): { useCase: ReviewPharmacyApplicationUseCase; saved: PharmacyAccount[] } {
  const saved: PharmacyAccount[] = []
  const accounts = {
    findById: () => Promise.resolve(pendingAccount()),
    save: (account: PharmacyAccount) => {
      saved.push(account)
      return Promise.resolve()
    },
  } as unknown as PharmacyAccountRepositoryPort
  const verifications = { findBySubject: () => Promise.resolve(null) } as unknown as PharmacyVerificationRepositoryPort
  const log = { append: () => Promise.resolve() } as unknown as OnboardingReviewLogRepositoryPort
  const chains: PharmacyChainStatusPort = { getStatus: () => Promise.resolve(chainStatus) }
  return { useCase: new ReviewPharmacyApplicationUseCase(accounts, verifications, log, chains), saved }
}

const APPROVE_INPUT = { pharmacyId: PHARMACY_ID, actorId: ACTOR_ID, checklist: { license_is_valid: true }, notes: null }

describe('ReviewPharmacyApplicationUseCase.approve — активация', () => {
  it.each<OnboardingStatus>(['approved', 'active'])('активирует аптеку при сети %s', async (chainStatus) => {
    const { useCase, saved } = build(chainStatus)
    const result = await useCase.approve(APPROVE_INPUT)
    expect(result.status).toBe('active')
    expect(saved.map((a) => a.status)).toEqual(['active'])
  })

  it.each<OnboardingStatus | null>(['pending_review', 'suspended', 'terminated', null])(
    'оставляет approved при сети %s',
    async (chainStatus) => {
      const { useCase, saved } = build(chainStatus)
      const result = await useCase.approve(APPROVE_INPUT)
      expect(result.status).toBe('approved')
      expect(saved.map((a) => a.status)).toEqual(['approved'])
    },
  )
})
