/**
 * Параметризованный тест `OnboardingStatus.isTransitionAllowed` (DTJ-063, DoD п.2):
 * КАЖДАЯ пара `(from, to)` из 8×8 = 64 комбинаций проверена явно, не только
 * happy-path. Включая терминальность `terminated` (нет исходящих переходов).
 */
import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_STATUS_VALUES,
  assertTransitionAllowed,
  isOnboardingStatus,
  isTransitionAllowed,
} from './onboarding-status.vo.js'
import { InvalidOnboardingTransitionError } from '@dorutj/contracts'

/**
 * Ожидаемая матрица переходов. Ключ — `from`, значение — массив допустимых `to`.
 * Если `to` не в массиве — переход запрещён.
 */
const EXPECTED_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  draft: ['pending_review', 'terminated'],
  pending_review: ['changes_requested', 'approved', 'rejected', 'terminated'],
  changes_requested: ['pending_review', 'rejected', 'terminated'],
  approved: ['active', 'terminated'],
  active: ['suspended', 'terminated'],
  suspended: ['pending_review', 'terminated'],
  rejected: [],
  terminated: [],
}

describe('OnboardingStatus.isTransitionAllowed', () => {
  // Полный перебор всех пар
  for (const from of ONBOARDING_STATUS_VALUES) {
    for (const to of ONBOARDING_STATUS_VALUES) {
      const shouldAllow = EXPECTED_ALLOWED[from]?.includes(to) === true
      const label = shouldAllow ? 'should allow' : 'should forbid'
      it(`${label} ${from} -> ${to}`, () => {
        expect(isTransitionAllowed(from, to)).toBe(shouldAllow)
      })
    }
  }

  it('запрещает самопереход (from === to)', () => {
    for (const s of ONBOARDING_STATUS_VALUES) {
      expect(isTransitionAllowed(s, s)).toBe(false)
    }
  })

  it('terminated терминально НАВСЕГДА (нет исходящих переходов)', () => {
    for (const to of ONBOARDING_STATUS_VALUES) {
      expect(isTransitionAllowed('terminated', to)).toBe(false)
    }
  })

  it('rejected терминально (повторная подача — операция use case, не цепочки)', () => {
    for (const to of ONBOARDING_STATUS_VALUES) {
      expect(isTransitionAllowed('rejected', to)).toBe(false)
    }
  })

  it('запрещён переход draft -> active напрямую (только через approved)', () => {
    expect(isTransitionAllowed('draft', 'active')).toBe(false)
  })

  it('разрешён переход approved -> active (SRS-DOM-161, REQ-ONBOARD-9)', () => {
    expect(isTransitionAllowed('approved', 'active')).toBe(true)
  })

  it('разрешён переход active -> suspended (SRS-DOM-050)', () => {
    expect(isTransitionAllowed('active', 'suspended')).toBe(true)
  })

  it('разрешён переход suspended -> pending_review (SRS-ADM-019, requestReactivation)', () => {
    expect(isTransitionAllowed('suspended', 'pending_review')).toBe(true)
  })
})

describe('OnboardingStatus.assertTransitionAllowed', () => {
  it('бросает InvalidOnboardingTransitionError при запрещённом переходе', () => {
    expect(() => {
      assertTransitionAllowed('terminated', 'active')
    }).toThrow(InvalidOnboardingTransitionError)
  })

  it('НЕ бросает при разрешённом переходе', () => {
    expect(() => {
      assertTransitionAllowed('draft', 'pending_review')
    }).not.toThrow()
  })
})

describe('OnboardingStatus.isOnboardingStatus', () => {
  it('true для всех валидных значений', () => {
    for (const s of ONBOARDING_STATUS_VALUES) {
      expect(isOnboardingStatus(s)).toBe(true)
    }
  })

  it('false для произвольной строки', () => {
    expect(isOnboardingStatus('unknown')).toBe(false)
    expect(isOnboardingStatus('')).toBe(false)
    expect(isOnboardingStatus('DRAFT')).toBe(false)
  })
})
