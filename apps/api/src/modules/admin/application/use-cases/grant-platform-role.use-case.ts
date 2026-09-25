// audit.write() — последний шаг колбэка unitOfWork.run: если он бросает, роль ещё не закоммичена
// и откатывается вместе с ним (AuditLogPort сам tx не принимает, но это не нужно при таком порядке).
import { Inject, Injectable } from '@nestjs/common'
import { GrantPlatformRoleBodySchema, NotFoundError, ValidationError, type GrantPlatformRoleBodyDto } from '@dorutj/contracts'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/modules/auth/index.js'
import { IDENTITY_FACADE_PORT, type IdentityFacadePort, type UserSummaryView } from '../ports/identity-facade.port.js'

const ROLE_GRANT_AUDIT_CATEGORY = 'role_grant'
const GRANT_PLATFORM_ROLE_ACTION = 'grant_platform_role'
const USER_ENTITY_TYPE = 'user'

export interface GrantPlatformRoleCommand {
  readonly userId: string
  readonly rawBody: unknown
  readonly actor: { readonly userId: string }
  readonly requestId: string | null
}

@Injectable()
export class GrantPlatformRoleUseCase {
  public constructor(
    @Inject(IDENTITY_FACADE_PORT) private readonly identityFacade: IdentityFacadePort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
  ) {}

  public async execute(command: GrantPlatformRoleCommand): Promise<UserSummaryView> {
    const body = parseBody(command.rawBody)
    return this.unitOfWork.run(async (tx) => {
      const result = await this.identityFacade.grantPlatformRole({
        userId: command.userId,
        role: body.role,
        actor: { userId: command.actor.userId },
        tx,
      })
      if (result === null) {
        throw new NotFoundError({ resource: 'user', userId: command.userId })
      }
      await this.auditLog.write({
        category: ROLE_GRANT_AUDIT_CATEGORY,
        entityType: USER_ENTITY_TYPE,
        entityId: command.userId,
        actorUserId: command.actor.userId,
        action: GRANT_PLATFORM_ROLE_ACTION,
        reason: body.reason,
        metadata: { before: { role: result.previousRole }, after: { role: body.role } },
        requestId: command.requestId,
        tenantId: result.user.tenantId,
      })
      return result.user
    })
  }
}

function parseBody(rawBody: unknown): GrantPlatformRoleBodyDto {
  const parsed = GrantPlatformRoleBodySchema.safeParse(rawBody)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid grant-platform-role request', {
    field: firstIssue === undefined ? 'role' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
