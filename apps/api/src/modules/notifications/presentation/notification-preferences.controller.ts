// Собственные настройки: userId из JWT, параметра в пути/query нет — чужие настройки структурно недостижимы.
import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common'
import { ok, USER_ROLES, type SuccessEnvelope } from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetUserPreferencesUseCase } from '../application/use-cases/get-user-preferences.use-case.js'
import { UpdateUserPreferencesUseCase } from '../application/use-cases/update-user-preferences.use-case.js'
import type { NotificationPreferenceView } from '../application/ports/notification-preferences-repository.port.js'

export interface NotificationPreferenceDto {
  readonly category: string
  readonly channel: string
  readonly isEnabled: boolean
  readonly quietHoursStart: string | null
  readonly quietHoursEnd: string | null
  readonly updatedAt: string
}

@Controller({ path: 'notification-preferences', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...USER_ROLES)
export class NotificationPreferencesController {
  public constructor(
    @Inject(GetUserPreferencesUseCase) private readonly getUserPreferences: GetUserPreferencesUseCase,
    @Inject(UpdateUserPreferencesUseCase) private readonly updateUserPreferences: UpdateUserPreferencesUseCase,
  ) {}

  @Get()
  public async get(@CurrentUser() claims: JwtClaims): Promise<SuccessEnvelope<readonly NotificationPreferenceDto[]>> {
    const preferences = await this.getUserPreferences.execute({ userId: claims.sub })
    return ok(preferences.map(toDto))
  }

  @Patch()
  public async patch(
    @Body() rawPatch: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly NotificationPreferenceDto[]>> {
    const preferences = await this.updateUserPreferences.execute({ userId: claims.sub, rawPatch })
    return ok(preferences.map(toDto))
  }
}

function toDto(preference: NotificationPreferenceView): NotificationPreferenceDto {
  return {
    category: preference.category,
    channel: preference.channel,
    isEnabled: preference.isEnabled,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    updatedAt: preference.updatedAt.toISOString(),
  }
}
