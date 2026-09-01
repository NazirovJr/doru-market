/**
 * Unit-тесты `PharmacyAccount` (DTJ-063, DoD п.1–3):
 * - SRS-DOM-048: activate(parentChainStatus='pending_review') → ParentChainNotActiveError
 * - SRS-DOM-049: updateAddress на active → status='pending_review'
 * - SRS-DOM-050: прямой activate() из suspended → AutomaticReactivationForbiddenError
 * - chainId обязателен
 * - сценарии suspend/reject/terminate/approve/requestChanges
 */
import { describe, expect, it } from 'vitest'
import { InvalidOnboardingTransitionError, ValidationError } from '@dorutj/contracts'
import { ParentChainNotActiveError } from './errors/parent-chain-not-active.error.js'
import { PharmacyAccount, type PharmacyAccountCreateCommand } from './pharmacy-account.entity.js'

const ACTOR = { id: 'actor-uuid' }

/**
 * `Date` допустим в спецификации, потому что это тестовая фикстура (см.
 * `pharmacy-chain.entity.spec.ts` с аналогичным обоснованием).
 */
const NOW: Date = new Date('2026-01-15T10:00:00Z') // eslint-disable-line no-restricted-globals -- тестовая фикстура (фиксированная дата), не продовый код (`02` §2.6 запрещает `Date.now()`/создание `Date` в `domain/`, но тесты — часть test-suite).
const FUTURE: Date = new Date('2027-12-31') // eslint-disable-line no-restricted-globals -- тестовая фикстура (фиксированная дата), не продовый код.

function newAccountCommand(overrides?: Partial<PharmacyAccountCreateCommand>): PharmacyAccountCreateCommand {
  return {
    id: 'pharmacy-uuid-1',
    chainId: 'chain-uuid-1',
    name: 'Аптека на Рудаки',
    addressText: 'Dushanbe, Rudaki 1',
    latitude: 38.5731,
    longitude: 68.7864,
    phone: '+992900000000',
    licenseNumber: 'LIC-001',
    licenseExpiryDate: FUTURE,
    ...overrides,
  }
}

describe('PharmacyAccount.create', () => {
  it('создаёт заявку в draft', () => {
    const account = PharmacyAccount.create(newAccountCommand())
    expect(account.status).toBe('draft')
    expect(account.chainId).toBe('chain-uuid-1')
    expect(account.suspensionReason).toBeNull()
  })

  it('бросает ValidationError при пустом chainId (SRS-DOM-047)', () => {
    expect(() => PharmacyAccount.create(newAccountCommand({ chainId: '' }))).toThrow(ValidationError)
  })

  it('бросает ValidationError при невалидных координатах', () => {
    expect(() => PharmacyAccount.create(newAccountCommand({ latitude: 100 }))).toThrow(ValidationError)
    expect(() => PharmacyAccount.create(newAccountCommand({ longitude: -200 }))).toThrow(ValidationError)
  })

  it('бросает ValidationError при отсутствии licenseExpiryDate', () => {
    expect(() =>
      PharmacyAccount.create(newAccountCommand({ licenseExpiryDate: null as unknown as Date })),
    ).toThrow(ValidationError)
  })
})

describe('PharmacyAccount.activate (SRS-DOM-048)', () => {
  it('approved → active при parentChainStatus="approved"', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW).approve(ACTOR)
    const activated = acc.activate(ACTOR, 'approved')
    expect(activated.status).toBe('active')
  })

  it('approved → active при parentChainStatus="active"', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW).approve(ACTOR)
    const activated = acc.activate(ACTOR, 'active')
    expect(activated.status).toBe('active')
  })

  it('бросает ParentChainNotActiveError при parentChainStatus="pending_review"', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW).approve(ACTOR)
    expect(() => acc.activate(ACTOR, 'pending_review')).toThrow(ParentChainNotActiveError)
  })

  it('бросает ParentChainNotActiveError при parentChainStatus="suspended"', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW).approve(ACTOR)
    expect(() => acc.activate(ACTOR, 'suspended')).toThrow(ParentChainNotActiveError)
  })

  it('бросает ParentChainNotActiveError при parentChainStatus="rejected"', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW).approve(ACTOR)
    expect(() => acc.activate(ACTOR, 'rejected')).toThrow(ParentChainNotActiveError)
  })
})

describe('PharmacyAccount.updateAddress (SRS-DOM-049)', () => {
  it('active → pending_review при изменении адреса', () => {
    const acc = PharmacyAccount.create(newAccountCommand())
      .submitForReview(NOW)
      .approve(ACTOR)
      .activate(ACTOR, 'active')
    const updated = acc.updateAddress({
      addressText: 'Dushanbe, Rudaki 99',
      latitude: 38.58,
      longitude: 68.79,
    })
    expect(updated.status).toBe('pending_review')
    expect(updated.addressText).toBe('Dushanbe, Rudaki 99')
  })

  it('запрещено для НЕactive аптеки', () => {
    const acc = PharmacyAccount.create(newAccountCommand())
    expect(() => acc.updateAddress({ addressText: 'X', latitude: 1, longitude: 1 })).toThrow(ValidationError)
  })
})

describe('PharmacyAccount.suspend / requestReactivation (SRS-DOM-050, REQ-ONBOARD-17)', () => {
  it('active → suspended с reason', () => {
    const acc = PharmacyAccount.create(newAccountCommand())
      .submitForReview(NOW)
      .approve(ACTOR)
      .activate(ACTOR, 'active')
    const suspended = acc.suspend('voluntary_pause', ACTOR)
    expect(suspended.status).toBe('suspended')
    expect(suspended.suspensionReason).toBe('voluntary_pause')
  })

  it('бросает ValidationError при невалидном reason', () => {
    const acc = PharmacyAccount.create(newAccountCommand())
      .submitForReview(NOW)
      .approve(ACTOR)
      .activate(ACTOR, 'active')
    expect(() => acc.suspend('invalid_reason' as 'voluntary_pause', ACTOR)).toThrow(ValidationError)
  })

  it('suspended → pending_review через requestReactivation (легитимный путь)', () => {
    const acc = PharmacyAccount.create(newAccountCommand())
      .submitForReview(NOW)
      .approve(ACTOR)
      .activate(ACTOR, 'active')
      .suspend('voluntary_pause', ACTOR)
    const reactivated = acc.requestReactivation()
    expect(reactivated.status).toBe('pending_review')
  })

  it('прямой activate() из suspended → AutomaticReactivationForbiddenError', () => {
    const acc = PharmacyAccount.create(newAccountCommand())
      .submitForReview(NOW)
      .approve(ACTOR)
      .activate(ACTOR, 'active')
      .suspend('voluntary_pause', ACTOR)
    expect(() => acc.activate(ACTOR, 'active')).toThrow()
  })
})

describe('PharmacyAccount state machine (прочие переходы)', () => {
  it('draft → pending_review → approved', () => {
    const acc = PharmacyAccount.create(newAccountCommand())
    const submitted = acc.submitForReview(NOW)
    expect(submitted.status).toBe('pending_review')

    const approved = submitted.approve(ACTOR)
    expect(approved.status).toBe('approved')
  })

  it('pending_review → changes_requested (requestChanges)', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW)
    const changesReq = acc.requestChanges(ACTOR, 'reason')
    expect(changesReq.status).toBe('changes_requested')
  })

  it('pending_review → rejected', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW)
    expect(acc.reject(ACTOR, 'reason').status).toBe('rejected')
  })

  it('terminated — терминально НАВСЕГДА', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).terminate(ACTOR, 'fraud')
    expect(() => acc.approve(ACTOR)).toThrow(InvalidOnboardingTransitionError)
  })

  it('запрещена повторная submitForReview из pending_review', () => {
    const acc = PharmacyAccount.create(newAccountCommand()).submitForReview(NOW)
    expect(() => acc.submitForReview(NOW)).toThrow(InvalidOnboardingTransitionError)
  })
})
