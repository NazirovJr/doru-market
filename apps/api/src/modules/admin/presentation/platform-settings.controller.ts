// Только GET: PATCH/POST/DELETE физически не зарегистрированы, роутинг сам отвечает 404.
import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { ok, type PlatformSettingDto, type SuccessEnvelope } from '@dorutj/contracts'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import { GetPlatformSettingsUseCase } from '../application/use-cases/get-platform-settings.use-case.js'

@Controller({ path: 'platform-settings', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class PlatformSettingsController {
  public constructor(@Inject(GetPlatformSettingsUseCase) private readonly getPlatformSettings: GetPlatformSettingsUseCase) {}

  @Get()
  public list(): SuccessEnvelope<readonly PlatformSettingDto[]> {
    return ok(this.getPlatformSettings.execute())
  }
}
