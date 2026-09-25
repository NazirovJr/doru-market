/**
 * `TenantMetaController` (DTJ-033) — `GET /api/v1/tenant/meta`, SRS-INV-047. `tenantId` — из
 * `TenantContext`, не из JWT-claims (`super_admin` работает межтенантно, `claims.tenantId === null`),
 * тот же приём, что `PharmaciesMapController.resolveTenantId`; строка отдаётся use case'у КАК ЕСТЬ,
 * `TenantId.from` вызывается внутри него (`02` §6).
 */
import { Controller, Get, Inject, InternalServerErrorException, UseGuards } from '@nestjs/common'
import { ErrorCode, ok, type SuccessEnvelope, type TenantMetaDto } from '@dorutj/contracts'
import { TenantContext } from '@/common/context/tenant-context.js'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import { GetTenantMetaUseCase } from '@/modules/tenancy/application/use-cases/get-tenant-meta.use-case.js'

@Controller({ path: 'tenant/meta', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacist', 'pharmacy_admin', 'super_admin')
export class TenantMetaController {
  // Явный @Inject: esbuild (vitest) не эмитит design:paramtypes (DTJ-001).
  constructor(
    @Inject(GetTenantMetaUseCase) private readonly getTenantMeta: GetTenantMetaUseCase,
  ) {}

  @Get()
  async getMeta(): Promise<SuccessEnvelope<TenantMetaDto>> {
    const tenantId = resolveTenantId()
    const result = await this.getTenantMeta.execute({ tenantId })
    return ok(result)
  }
}

// 1:1 с PharmaciesMapController.resolveTenantId, но возвращает сырую строку (см. JSDoc файла).
function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    // Недостижимо при корректно подключённом `TenantResolutionMiddleware` + `TenantScopeGuard`.
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
