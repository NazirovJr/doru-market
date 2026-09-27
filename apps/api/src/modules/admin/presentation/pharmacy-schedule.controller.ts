// DTJ-367: расписание работы и круговая зона доставки. Тело PATCH парсится use case'ом (не здесь) —
// та же причина, что update-tenant-settings.use-case.ts: невалидная запись не должна пройти дальше.
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common'
import { ok, type PharmacyDeliveryZoneDto, type PharmacyScheduleAndZoneDto, type PharmacyScheduleDto, type SuccessEnvelope } from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { RequestContext } from '@/common/context/request-context.js'
import { UpdatePharmacyScheduleUseCase } from '../application/use-cases/update-pharmacy-schedule.use-case.js'
import { UpdateDeliveryZoneUseCase } from '../application/use-cases/update-delivery-zone.use-case.js'
import { GetPharmacyScheduleUseCase } from '../application/use-cases/get-pharmacy-schedule.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class PharmacyScheduleController {
  public constructor(
    @Inject(GetPharmacyScheduleUseCase) private readonly getScheduleUseCase: GetPharmacyScheduleUseCase,
    @Inject(UpdatePharmacyScheduleUseCase) private readonly updateScheduleUseCase: UpdatePharmacyScheduleUseCase,
    @Inject(UpdateDeliveryZoneUseCase) private readonly updateDeliveryZoneUseCase: UpdateDeliveryZoneUseCase,
  ) {}

  @Get('pharmacy-accounts/:id/schedule')
  @Roles('pharmacy_admin', 'super_admin')
  public async getSchedule(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<PharmacyScheduleAndZoneDto>> {
    const view = await this.getScheduleUseCase.execute({ pharmacyId: id, actor: { role: claims.role, chainId: claims.chainId } })
    return ok(view)
  }

  @Patch('pharmacy-accounts/:id/schedule')
  @Roles('pharmacy_admin', 'super_admin')
  public async updateSchedule(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() rawBody: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<PharmacyScheduleDto>> {
    const view = await this.updateScheduleUseCase.execute({
      pharmacyId: id,
      rawBody,
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId, tenantId: claims.tenantId },
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(view)
  }

  @Patch('pharmacy-accounts/:id/delivery-zone')
  @Roles('pharmacy_admin', 'super_admin')
  public async updateDeliveryZone(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() rawBody: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<PharmacyDeliveryZoneDto>> {
    const view = await this.updateDeliveryZoneUseCase.execute({
      pharmacyId: id,
      rawBody,
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId, tenantId: claims.tenantId },
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(view)
  }
}
