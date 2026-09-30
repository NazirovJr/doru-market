import { describe, expect, it } from 'vitest'
import { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import { PharmacyChain } from '@/modules/onboarding/domain/pharmacy-chain.entity.js'
import type { PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import type { PharmacyVerificationRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import type { OnboardingReviewLogRepositoryPort } from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'
import { ReviewChainApplicationUseCase } from './review-chain-application.use-case.js'

const CHAIN_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'

function pharmacy(id: string, status: 'approved' | 'pending_review' | 'suspended'): PharmacyAccount {
  const draft = PharmacyAccount.create({
    id,
    chainId: CHAIN_ID,
    name: 'Test',
    addressText: 'Dushanbe',
    latitude: 38.5,
    longitude: 68.7,
    phone: '+992900000001',
    licenseNumber: 'L-1',
    licenseExpiryDate: new Date('2030-01-01'),
  })
  const pending = draft.submitForReview(new Date())
  if (status === 'approved') {
    return pending.approve({ id: ACTOR_ID })
  }
  return status === 'pending_review' ? pending : PharmacyAccount.restore({ ...pending.props, status })
}

function pendingChain(): PharmacyChain {
  return PharmacyChain.restore({
    ...PharmacyChain.create({
      id: CHAIN_ID,
      name: 'LLC',
      legalEntityName: 'LLC',
      tinInn: '123456789',
      directorFullName: 'Director',
      contactPhone: '+992900000000',
      legalAddress: 'Dushanbe',
      isWhitelabelRequested: false,
    }).props,
    status: 'pending_review',
  })
}

describe('ReviewChainApplicationUseCase.approve — активация точек сети', () => {
  it('активирует только точки в статусе approved', async () => {
    const saved: PharmacyAccount[] = []
    const chains = { findById: () => Promise.resolve(pendingChain()), save: () => Promise.resolve() } as unknown as PharmacyChainRepositoryPort
    const accounts = {
      listByChain: () => Promise.resolve([pharmacy('a', 'approved'), pharmacy('b', 'pending_review'), pharmacy('c', 'suspended')]),
      save: (account: PharmacyAccount) => {
        saved.push(account)
        return Promise.resolve()
      },
    } as unknown as PharmacyAccountRepositoryPort
    const verifications = { findBySubject: () => Promise.resolve(null) } as unknown as PharmacyVerificationRepositoryPort
    const log = { append: () => Promise.resolve() } as unknown as OnboardingReviewLogRepositoryPort
    const useCase = new ReviewChainApplicationUseCase(chains, verifications, log, accounts)

    const result = await useCase.approve({ chainId: CHAIN_ID, actorId: ACTOR_ID, checklist: {}, notes: null })

    expect(result.status).toBe('approved')
    expect(saved.map((account) => [account.id, account.status])).toEqual([['a', 'active']])
  })
})
