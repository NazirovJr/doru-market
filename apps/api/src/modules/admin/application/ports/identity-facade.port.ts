// identity не экспортирует свой класс-фасад — тот же приём, что tenancy-facade.port.ts.
import type { PlatformRole, StaffRole, UserRole } from '@dorutj/contracts'
import type { UnitOfWorkTx } from '@/modules/auth/index.js'

export const IDENTITY_FACADE_PORT = Symbol.for('@dorutj/admin/identity-facade')

export interface IdentityListCursor {
  readonly v: string
  readonly id: string
}

export interface IdentityListFilter {
  readonly role?: UserRole
  readonly phoneLike?: string
  readonly tenantId?: string
}

export interface IdentityListQuery {
  readonly filter: IdentityListFilter
  readonly limit: number
  readonly cursor?: IdentityListCursor | null
}

export interface UserSummaryView {
  readonly id: string
  readonly tenantId: string
  readonly phoneNumber: string | null
  readonly role: UserRole
  readonly fullName: string | null
  readonly isActive: boolean
  readonly createdAt: Date
}

export interface IdentityListPage {
  readonly items: readonly UserSummaryView[]
  readonly nextCursor: IdentityListCursor | null
  readonly hasMore: boolean
}

export interface IdentityFacadeActor {
  readonly userId: string
}

// previousRole нужен для metadata.before/after записи аудита.
export interface RoleChangeResult {
  readonly user: UserSummaryView
  readonly previousRole: UserRole
}

export interface ChangeStaffRoleFacadeCommand {
  readonly userId: string
  readonly newRole: StaffRole
  readonly actor: IdentityFacadeActor
}

export interface GrantPlatformRoleFacadeCommand {
  readonly userId: string
  readonly role: PlatformRole
  readonly actor: IdentityFacadeActor
  readonly tx: UnitOfWorkTx
}

// null у deactivateUser/changeStaffRole/grantPlatformRole — пользователь не найден (404 NOT_FOUND).
export interface IdentityFacadePort {
  listUsers(query: IdentityListQuery): Promise<IdentityListPage>
  deactivateUser(userId: string, actor: IdentityFacadeActor): Promise<UserSummaryView | null>
  changeStaffRole(command: ChangeStaffRoleFacadeCommand): Promise<RoleChangeResult | null>
  grantPlatformRole(command: GrantPlatformRoleFacadeCommand): Promise<RoleChangeResult | null>
}
