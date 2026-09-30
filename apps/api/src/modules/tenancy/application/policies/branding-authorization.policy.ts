import type { UserRole } from '@dorutj/contracts'

export interface BrandingPolicyActor {
  readonly role: UserRole
  readonly tenantId: string | null
}

export interface BrandingPolicyTarget {
  readonly id: string
  readonly isNeutral: boolean
}

export const BrandingAuthorizationPolicy = {
  // Нейтральный тенант — общий бренд платформы: его правит только super_admin, не pharmacy_admin.
  canManage(actor: BrandingPolicyActor, target: BrandingPolicyTarget | null): boolean {
    if (actor.role === 'super_admin') {
      return true
    }
    return actor.role === 'pharmacy_admin' && target !== null && !target.isNeutral && actor.tenantId === target.id
  },
}
