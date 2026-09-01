/**
 * `PharmacyAccountsAdminController` (DTJ-073) — `GET /pharmacy-accounts` с
 * фильтром `filter[licenseExpiryDate][lte]` для `apps/admin` (список
 * истекающих лицензий). `super_admin` only.
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ok } from '@dorutj/contracts'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import { ListExpiringLicensesUseCase } from '@/modules/onboarding/application/use-cases/list-expiring-licenses.use-case.js'

const DEFAULT_WITHIN_DAYS = 30

@Controller({ path: 'admin/pharmacy-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class PharmacyAccountsAdminController {
  constructor(private readonly listExpiringLicenses: ListExpiringLicensesUseCase) {}

  @Get()
  async listExpiring(
    @Query('filter[licenseExpiryDate][lte]') lteRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ): Promise<unknown> {
    const withinDays = parseWithinDays(lteRaw)
    const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined
    const offset = offsetRaw !== undefined ? Number.parseInt(offsetRaw, 10) : undefined
    const result = await this.listExpiringLicenses.execute({
      withinDays,
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    })
    return ok(result)
  }
}

function parseWithinDays(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_WITHIN_DAYS
  }
  const days = Number.parseInt(raw, 10)
  if (!Number.isFinite(days) || days < 0) {
    return DEFAULT_WITHIN_DAYS
  }
  return days
}
