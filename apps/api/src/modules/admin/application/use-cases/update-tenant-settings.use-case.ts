// Валидация патча — здесь, не в контроллере: невалидная запись не должна доходить до facade.
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError, ValidationError, TenantSettingsPatchSchema, type TenantSettingsPatchDto } from '@dorutj/contracts'
import {
  TENANCY_FACADE_PORT,
  type TenancyFacadePort,
  type TenantDetailView,
  type TenantSettingsPatch,
} from '../ports/tenancy-facade.port.js'

export interface UpdateTenantSettingsCommand {
  readonly tenantId: string
  readonly rawPatch: unknown
  readonly actor: { readonly userId: string }
}

@Injectable()
export class UpdateTenantSettingsUseCase {
  public constructor(@Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort) {}

  public async execute(command: UpdateTenantSettingsCommand): Promise<TenantDetailView> {
    const patch = parsePatch(command.rawPatch)
    const updated = await this.tenancyFacade.updateTenantSettings(command.tenantId, toPortPatch(patch), {
      userId: command.actor.userId,
    })
    if (updated === null) {
      throw new NotFoundError({ resource: 'tenant', tenantId: command.tenantId })
    }
    return updated
  }
}

// exactOptionalPropertyTypes: непереданные ключи опускаются целиком, не копируются как undefined.
function toPortPatch(patch: TenantSettingsPatchDto): TenantSettingsPatch {
  return {
    ...(patch.brandName !== undefined && { brandName: patch.brandName }),
    ...(patch.brandLogoUrl !== undefined && { brandLogoUrl: patch.brandLogoUrl }),
    ...(patch.brandPalette !== undefined && { brandPalette: patch.brandPalette }),
    ...(patch.codLimitDiram !== undefined && { codLimitDiram: patch.codLimitDiram }),
    ...(patch.holdPeriodDays !== undefined && { holdPeriodDays: patch.holdPeriodDays }),
  }
}

function parsePatch(rawPatch: unknown): TenantSettingsPatchDto {
  const parsed = TenantSettingsPatchSchema.safeParse(rawPatch)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid tenant settings patch', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
