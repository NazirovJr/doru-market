import { describe, expect, it } from 'vitest'
import type { UserRole } from '@dorutj/contracts'
import { BrandingAuthorizationPolicy, type BrandingPolicyTarget } from './branding-authorization.policy.js'

const TENANT: BrandingPolicyTarget = { id: 'tenant-a', isNeutral: false }
const NEUTRAL: BrandingPolicyTarget = { id: 'tenant-a', isNeutral: true }

interface Case {
  readonly role: UserRole
  readonly tenantId: string | null
  readonly target: BrandingPolicyTarget | null
  readonly expected: boolean
}

const CASES: readonly Case[] = [
  { role: 'super_admin', tenantId: null, target: TENANT, expected: true },
  { role: 'super_admin', tenantId: 'tenant-b', target: NEUTRAL, expected: true },
  { role: 'super_admin', tenantId: null, target: null, expected: true },
  { role: 'pharmacy_admin', tenantId: 'tenant-a', target: TENANT, expected: true },
  { role: 'pharmacy_admin', tenantId: 'tenant-b', target: TENANT, expected: false },
  { role: 'pharmacy_admin', tenantId: null, target: TENANT, expected: false },
  { role: 'pharmacy_admin', tenantId: 'tenant-a', target: NEUTRAL, expected: false },
  { role: 'pharmacy_admin', tenantId: 'tenant-a', target: null, expected: false },
  { role: 'pharmacist', tenantId: 'tenant-a', target: TENANT, expected: false },
  { role: 'customer', tenantId: 'tenant-a', target: TENANT, expected: false },
  { role: 'support_agent', tenantId: 'tenant-a', target: TENANT, expected: false },
]

describe('BrandingAuthorizationPolicy.canManage', () => {
  it.each(CASES)('$role (tenant=$tenantId, target=$target) → $expected', ({ role, tenantId, target, expected }) => {
    expect(BrandingAuthorizationPolicy.canManage({ role, tenantId }, target)).toBe(expected)
  })
})
