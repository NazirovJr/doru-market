// Тот же приём, что tenancy-facade.adapter.ts — узкий адаптер поверх чужого репозитория.
import { Inject, Injectable } from '@nestjs/common'
import type { PlatformRole, StaffRole } from '@dorutj/contracts'
import { USERS_REPOSITORY, type User, type UnitOfWorkTx, type UsersRepository } from '@/modules/auth/index.js'
import {
  IDENTITY_FACADE_PORT,
  type ChangeStaffRoleFacadeCommand,
  type GrantPlatformRoleFacadeCommand,
  type IdentityFacadeActor,
  type IdentityFacadePort,
  type IdentityListPage,
  type IdentityListQuery,
  type RoleChangeResult,
  type UserSummaryView,
} from '@/modules/admin/application/ports/identity-facade.port.js'

@Injectable()
export class IdentityFacadeAdapter implements IdentityFacadePort {
  public constructor(@Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepository) {}

  public async listUsers(query: IdentityListQuery): Promise<IdentityListPage> {
    const page = await this.usersRepository.list({
      filter: {
        ...(query.filter.role !== undefined && { role: query.filter.role }),
        ...(query.filter.phoneLike !== undefined && { phoneLike: query.filter.phoneLike }),
        ...(query.filter.tenantId !== undefined && { tenantId: query.filter.tenantId }),
      },
      limit: query.limit,
      cursor: query.cursor ?? null,
    })
    return { items: page.items.map(toSummaryView), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }

  public async deactivateUser(userId: string, _actor: IdentityFacadeActor): Promise<UserSummaryView | null> {
    const updated = await this.usersRepository.setActive(userId, false)
    return updated === null ? null : toSummaryView(updated)
  }

  public async changeStaffRole(command: ChangeStaffRoleFacadeCommand): Promise<RoleChangeResult | null> {
    return this.applyRoleChange(command.userId, command.newRole)
  }

  public async grantPlatformRole(command: GrantPlatformRoleFacadeCommand): Promise<RoleChangeResult | null> {
    return this.applyRoleChange(command.userId, command.role, command.tx)
  }

  // previousRole читается ДО setRole — .returning() отдаёт только новое значение строки.
  private async applyRoleChange(
    userId: string,
    role: StaffRole | PlatformRole,
    tx?: UnitOfWorkTx,
  ): Promise<RoleChangeResult | null> {
    const existing = await this.usersRepository.findById(userId, tx)
    if (existing === null) {
      return null
    }
    const updated = await this.usersRepository.setRole(userId, role, tx)
    if (updated === null) {
      return null
    }
    return { user: toSummaryView(updated), previousRole: existing.role }
  }
}

function toSummaryView(user: User): UserSummaryView {
  return {
    id: user.id,
    tenantId: user.tenantId,
    phoneNumber: user.phoneNumber,
    role: user.role,
    fullName: user.fullName,
    isActive: user.isActive,
    createdAt: user.createdAt,
  }
}

export const IDENTITY_FACADE_PORT_PROVIDER = {
  provide: IDENTITY_FACADE_PORT,
  useClass: IdentityFacadeAdapter,
} as const
