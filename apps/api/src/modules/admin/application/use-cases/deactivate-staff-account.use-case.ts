// DTJ-364: PATCH /staff-accounts/:id. Отзывает все сессии сотрудника (DTJ-026) — иначе уже
// выданный accessToken продолжает работать до истечения TTL несмотря на isActive=false.
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { CrossChainAccessDeniedError } from '../errors/cross-chain-access-denied.error.js'
import {
  AUTH_SESSIONS_REPOSITORY,
  UNIT_OF_WORK,
  type AuthSessionsRepository,
  type UnitOfWorkPort,
} from '@/modules/auth/index.js'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort, type UserSummaryView } from '../ports/identity-facade.port.js'

const DEACTIVATABLE_ROLES: readonly string[] = ['pharmacist', 'courier']

export interface DeactivateStaffAccountCommand {
  readonly userId: string
  readonly actor: { readonly userId: string; readonly role: string; readonly chainId: string | null }
}

@Injectable()
export class DeactivateStaffAccountUseCase {
  public constructor(
    @Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort,
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  public async execute(command: DeactivateStaffAccountCommand): Promise<UserSummaryView> {
    const target = await this.getTargetOrThrow(command.userId)
    this.checkPolicy(command.actor, target)

    const updated = await this.identityFacade.deactivateUser(command.userId, { userId: command.actor.userId })
    if (updated === null) {
      throw new NotFoundError({ resource: 'user', userId: command.userId })
    }
    await this.uow.run(async (tx) => {
      await this.authSessions.revokeAllByUserId({ tx, userId: command.userId, reason: 'admin_force', now: new Date() })
    })
    return updated
  }

  private async getTargetOrThrow(userId: string): Promise<UserSummaryView> {
    const target = await this.identityFacade.getUser?.(userId)
    if (target === undefined || target === null) {
      throw new NotFoundError({ resource: 'user', userId })
    }
    return target
  }

  private checkPolicy(actor: DeactivateStaffAccountCommand['actor'], target: UserSummaryView): void {
    if (!DEACTIVATABLE_ROLES.includes(target.role)) {
      throw new ForbiddenError(`role="${target.role}" is not a staff-account role manageable by this endpoint`, {
        targetRole: target.role,
      })
    }
    if (actor.role === 'super_admin') {
      return
    }
    if ((target.chainId ?? null) !== actor.chainId) {
      throw new CrossChainAccessDeniedError('Staff account belongs to a different chain', {
        actorChainId: actor.chainId,
        targetChainId: target.chainId,
      })
    }
  }
}
