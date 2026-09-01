/**
 * Unit-тест `StaffAccountPolicy` (EP-01, DTJ-030) — полная таблица истинности.
 *
 * 13 кейсов — каждый явно задокументирован в SRS-API-035/036/038. Цель
 * теста — ЛОВИТЬ регрессии при любом изменении policy (например, попытка
 * разрешить `pharmacy_admin` создавать `super_admin` — должно быть видно
 * в diff'е spec'а).
 */
import { describe, expect, it } from 'vitest'
import {
  StaffAccountPolicy,
  type StaffAccountPolicyActor,
  type StaffAccountPolicyTarget,
} from './staff-account.policy.js'

const CHAIN_A = '11111111-1111-1111-1111-111111111111'
const CHAIN_B = '22222222-2222-2222-2222-222222222222'

const SUPER_ADMIN: StaffAccountPolicyActor = {
  role: 'super_admin',
  pharmacyId: null,
  chainId: null,
}

const PHARMACY_ADMIN_CHAIN_A: StaffAccountPolicyActor = {
  role: 'pharmacy_admin',
  pharmacyId: null,
  chainId: CHAIN_A,
}

const CUSTOMER: StaffAccountPolicyActor = {
  role: 'customer',
  pharmacyId: null,
  chainId: null,
}

describe('StaffAccountPolicy.canCreate (DTJ-030, SRS-API-035/036/038)', () => {
  it('1. super_admin → любой role, любой chainId: true', () => {
    expect(
      StaffAccountPolicy.canCreate(SUPER_ADMIN, { role: 'pharmacist', chainId: CHAIN_A }),
    ).toBe(true)
    expect(
      StaffAccountPolicy.canCreate(SUPER_ADMIN, { role: 'courier', chainId: null }),
    ).toBe(true)
    expect(
      StaffAccountPolicy.canCreate(SUPER_ADMIN, { role: 'super_admin', chainId: null }),
    ).toBe(true)
    expect(
      StaffAccountPolicy.canCreate(SUPER_ADMIN, { role: 'pharmacy_admin', chainId: CHAIN_A }),
    ).toBe(true)
  })

  it('2. pharmacy_admin → pharmacist в СВОЕЙ сети: true', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'pharmacist',
        chainId: CHAIN_A,
      }),
    ).toBe(true)
  })

  it('3. pharmacy_admin → pharmacist в ДРУГОЙ сети: false', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'pharmacist',
        chainId: CHAIN_B,
      }),
    ).toBe(false)
  })

  it('4. pharmacy_admin → pharmacist в той же сети без chainId: true (аптека без сети)', () => {
    const actor: StaffAccountPolicyActor = {
      role: 'pharmacy_admin',
      pharmacyId: null,
      chainId: null,
    }
    expect(
      StaffAccountPolicy.canCreate(actor, { role: 'pharmacist', chainId: null }),
    ).toBe(true)
  })

  it('5. pharmacy_admin → courier в СВОЕЙ сети (собственный флот): true', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'courier',
        chainId: CHAIN_A,
      }),
    ).toBe(true)
  })

  it('6. pharmacy_admin → courier с chainId=null (платформенный пул): false', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'courier',
        chainId: null,
      }),
    ).toBe(false)
  })

  it('7. pharmacy_admin → courier в другой сети: false', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'courier',
        chainId: CHAIN_B,
      }),
    ).toBe(false)
  })

  it('8. pharmacy_admin → pharmacy_admin: false (нет эскалации привилегий)', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'pharmacy_admin',
        chainId: CHAIN_A,
      }),
    ).toBe(false)
  })

  it('9. pharmacy_admin → super_admin: false (нет эскалации)', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'super_admin',
        chainId: CHAIN_A,
      }),
    ).toBe(false)
  })

  it('10. pharmacy_admin → support_agent: false', () => {
    expect(
      StaffAccountPolicy.canCreate(PHARMACY_ADMIN_CHAIN_A, {
        role: 'support_agent',
        chainId: CHAIN_A,
      }),
    ).toBe(false)
  })

  it('11. customer → любая роль: false', () => {
    const targets: StaffAccountPolicyTarget[] = [
      { role: 'pharmacist', chainId: null },
      { role: 'courier', chainId: null },
      { role: 'pharmacy_admin', chainId: null },
      { role: 'customer', chainId: null },
    ]
    for (const target of targets) {
      expect(StaffAccountPolicy.canCreate(CUSTOMER, target)).toBe(false)
    }
  })

  it('12. pharmacist → любая роль: false (нельзя создавать staff)', () => {
    const actor: StaffAccountPolicyActor = {
      role: 'pharmacist',
      pharmacyId: null,
      chainId: CHAIN_A,
    }
    expect(
      StaffAccountPolicy.canCreate(actor, { role: 'pharmacist', chainId: CHAIN_A }),
    ).toBe(false)
  })

  it('13. courier → любая роль: false', () => {
    const actor: StaffAccountPolicyActor = {
      role: 'courier',
      pharmacyId: null,
      chainId: CHAIN_A,
    }
    expect(
      StaffAccountPolicy.canCreate(actor, { role: 'courier', chainId: CHAIN_A }),
    ).toBe(false)
  })
})
