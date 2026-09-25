// Валидация newRole — здесь, НЕ в контроллере (AC1 DTJ-354): платформенная роль недостижима
// на уровне схемы, независимо от роли вызывающего, даже при прямом вызове use case в обход HTTP.
import { Inject, Injectable } from '@nestjs/common'
import { ChangeStaffRoleBodySchema, NotFoundError, ValidationError, type ChangeStaffRoleBodyDto } from '@dorutj/contracts'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort, type UserSummaryView } from '../ports/identity-facade.port.js'

export interface ChangeStaffRoleCommand {
  readonly userId: string
  readonly rawBody: unknown
  readonly actor: { readonly userId: string }
}

@Injectable()
export class ChangeStaffRoleUseCase {
  public constructor(@Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort) {}

  public async execute(command: ChangeStaffRoleCommand): Promise<UserSummaryView> {
    const body = parseBody(command.rawBody)
    const result = await this.identityFacade.changeStaffRole({
      userId: command.userId,
      newRole: body.newRole,
      actor: { userId: command.actor.userId },
    })
    if (result === null) {
      throw new NotFoundError({ resource: 'user', userId: command.userId })
    }
    return result.user
  }
}

function parseBody(rawBody: unknown): ChangeStaffRoleBodyDto {
  const parsed = ChangeStaffRoleBodySchema.safeParse(rawBody)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid staff role', {
    field: firstIssue === undefined ? 'newRole' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
