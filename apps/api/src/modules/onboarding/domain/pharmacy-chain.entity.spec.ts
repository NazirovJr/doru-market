/**
 * Unit-тесты `PharmacyChain` (DTJ-063, DoD п.1–4):
 * - happy-path: create() / submitForReview() / approve() / requestChanges() / reject()
 * - сценарий 4 (DoD): status='terminated' → любой переход бросает
 *   `InvalidOnboardingTransitionError`
 * - SRS-ADM-007: повторная подача (rejected → draft) сбрасывает submittedAt
 */
import { describe, expect, it } from 'vitest'
import { InvalidOnboardingTransitionError, ValidationError } from '@dorutj/contracts'
import { PharmacyChain, type PharmacyChainCreateCommand } from './pharmacy-chain.entity.js'

const ACTOR = { id: 'actor-uuid' }

/**
 * Фиксированный момент для тестов. `Date` допустим в спецификации, потому что
 * это тестовая фикстура, не продовый код (`02` §2.6 запрещает `Date.now()`/создание
 * `Date` в `domain/`, но тесты — часть test-suite, а не `domain`-код; linting
 * смягчён локально для фикстур теста).
 */
const NOW: Date = new Date('2026-01-15T10:00:00Z') // eslint-disable-line no-restricted-globals -- тестовая фикстура (фиксированная дата), не продовый код (`02` §2.6 запрещает `Date.now()`/создание `Date` в `domain/`, но тесты — часть test-suite).

function newChainCommand(overrides?: Partial<PharmacyChainCreateCommand>): PharmacyChainCreateCommand {
  return {
    id: 'chain-uuid-1',
    name: 'Pharma LLC',
    legalEntityName: 'Pharma LLC',
    tinInn: '123456789',
    directorFullName: 'Ivanov Ivan',
    contactPhone: '+992900000000',
    legalAddress: 'Dushanbe, str. A',
    isWhitelabelRequested: false,
    ...overrides,
  }
}

describe('PharmacyChain.create', () => {
  it('создаёт заявку в статусе draft', () => {
    const chain = PharmacyChain.create(newChainCommand())
    expect(chain.status).toBe('draft')
    expect(chain.tinInn).toBe('123456789')
    expect(chain.submittedAt).toBeNull()
    expect(chain.contactPhoneVerified).toBe(false)
    expect(chain.isWhitelabelActive).toBe(false)
  })

  it('бросает ValidationError при isWhitelabelRequested=true и пустом legalAddress', () => {
    expect(() =>
      PharmacyChain.create(newChainCommand({ isWhitelabelRequested: true, legalAddress: null })),
    ).toThrow(ValidationError)
  })

  it('бросает ValidationError при невалидном tinInn (слишком короткий)', () => {
    expect(() => PharmacyChain.create(newChainCommand({ tinInn: '12345' }))).toThrow(ValidationError)
  })

  it('бросает ValidationError при пустом legalEntityName', () => {
    expect(() => PharmacyChain.create(newChainCommand({ legalEntityName: '' }))).toThrow(ValidationError)
  })
})

describe('PharmacyChain state machine', () => {
  it('draft → pending_review (submitForReview)', () => {
    const chain = PharmacyChain.create(newChainCommand())
    const submitted = chain.submitForReview(NOW)
    expect(submitted.status).toBe('pending_review')
    expect(submitted.submittedAt).toEqual(NOW)
  })

  it('pending_review → approved (approve)', () => {
    const chain = PharmacyChain.create(newChainCommand()).submitForReview(NOW)
    const approved = chain.approve(ACTOR)
    expect(approved.status).toBe('approved')
  })

  it('pending_review → changes_requested (requestChanges), submittedAt сохраняется (REQ-ONBOARD-18)', () => {
    const chain = PharmacyChain.create(newChainCommand()).submitForReview(NOW)
    const changesReq = chain.requestChanges(ACTOR, 'нужны дополнительные документы')
    expect(changesReq.status).toBe('changes_requested')
    expect(changesReq.submittedAt).toEqual(NOW)
  })

  it('pending_review → rejected (reject)', () => {
    const chain = PharmacyChain.create(newChainCommand()).submitForReview(NOW)
    const rejected = chain.reject(ACTOR, 'отказ')
    expect(rejected.status).toBe('rejected')
  })

  it('* → terminated (terminate) из ЛЮБОГО состояния', () => {
    const draft = PharmacyChain.create(newChainCommand())
    expect(draft.terminate(ACTOR, 'доказанное мошенничество').status).toBe('terminated')

    const approved = draft.submitForReview(NOW).approve(ACTOR)
    const terminated = approved.terminate(ACTOR, 'мошенничество')
    expect(terminated.status).toBe('terminated')
  })

  it('terminated — терминально НАВСЕГДА (любой исходящий переход бросает)', () => {
    const terminated = PharmacyChain.create(newChainCommand()).terminate(ACTOR, 'мошенничество')
    expect(() => terminated.approve(ACTOR)).toThrow(InvalidOnboardingTransitionError)
    expect(() => terminated.reject(ACTOR, 'reason')).toThrow(InvalidOnboardingTransitionError)
    expect(() => terminated.requestChanges(ACTOR, 'reason')).toThrow(InvalidOnboardingTransitionError)
    expect(() => terminated.submitForReview(NOW)).toThrow(InvalidOnboardingTransitionError)
  })

  it('запрещена повторная submitForReview из pending_review (двойная подача)', () => {
    const submitted = PharmacyChain.create(newChainCommand()).submitForReview(NOW)
    expect(() => submitted.submitForReview(NOW)).toThrow(InvalidOnboardingTransitionError)
  })
})

describe('PharmacyChain.updateApplication', () => {
  it('обновляет поля в draft', () => {
    const chain = PharmacyChain.create(newChainCommand())
    const updated = chain.updateApplication({ directorFullName: 'Petrov Petr' })
    expect(updated.directorFullName).toBe('Petrov Petr')
  })

  it('rejected → повторное обновление (DTJ-064 п.3, переиспользование заявки) сбрасывает submittedAt', () => {
    const chain = PharmacyChain.create(newChainCommand()).submitForReview(NOW).reject(ACTOR, 'reason')
    const reSubmitted = chain.updateApplication({ directorFullName: 'New Director' })
    expect(reSubmitted.status).toBe('rejected')
    expect(reSubmitted.directorFullName).toBe('New Director')
    expect(reSubmitted.submittedAt).toBeNull()
  })

  it('запрещено обновление полей из pending_review (заявка уже подана)', () => {
    const submitted = PharmacyChain.create(newChainCommand()).submitForReview(NOW)
    expect(() => submitted.updateApplication({ directorFullName: 'X' })).toThrow(ValidationError)
  })
})

describe('PharmacyChain.markContactPhoneVerified', () => {
  it('помечает флаг verified', () => {
    const chain = PharmacyChain.create(newChainCommand())
    const verified = chain.markContactPhoneVerified()
    expect(verified.contactPhoneVerified).toBe(true)
  })
})
