import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort, type UserSummaryView } from '../ports/identity-facade.port.js'

export interface DeactivateUserCommand {
  readonly userId: string
  readonly actor: { readonly userId: string }
}

@Injectable()
export class DeactivateUserUseCase {
  public constructor(@Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort) {}

  public async execute(command: DeactivateUserCommand): Promise<UserSummaryView> {
    // SRS-ADM-030 — super_admin не может деактивировать сам себя (потерял бы доступ к панели).
    if (command.actor.userId === command.userId) {
      throw new ForbiddenError('Cannot deactivate own account', { userId: command.userId })
    }
    const updated = await this.identityFacade.deactivateUser(command.userId, { userId: command.actor.userId })
    if (updated === null) {
      throw new NotFoundError({ resource: 'user', userId: command.userId })
    }
    return updated
  }
}
