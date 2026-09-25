// GET/POST/PATCH /api/v1/delivery-zones. Тенант — из TenantContext, роль — super_admin-only.
import { Body, Controller, Get, HttpCode, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common'
import {
  createDeliveryZoneRequestSchema,
  ErrorCode,
  ok,
  updateDeliveryZoneRequestSchema,
  type CreateDeliveryZoneRequest,
  type SuccessEnvelope,
  type UpdateDeliveryZoneRequest,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { ManageDeliveryZonesUseCase } from '../application/use-cases/manage-delivery-zones.use-case.js'
import { toDeliveryZoneViewDto, type DeliveryZoneViewDto } from './delivery-zone-view.dto.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'delivery-zones', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DeliveryZonesController {
  public constructor(
    @Inject(ManageDeliveryZonesUseCase) private readonly manage: ManageDeliveryZonesUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.Ok)
  @Roles('super_admin')
  public async list(@CurrentUser() claims: JwtClaims): Promise<SuccessEnvelope<readonly DeliveryZoneViewDto[]>> {
    const zones = await this.manage.list(resolveTenantId(), { userId: claims.sub, role: claims.role })
    return ok(zones.map(toDeliveryZoneViewDto))
  }

  @Post()
  @HttpCode(HttpStatus.Created)
  @Roles('super_admin')
  public async create(
    @Body(new ZodValidationPipe(createDeliveryZoneRequestSchema)) body: CreateDeliveryZoneRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<DeliveryZoneViewDto>> {
    const zone = await this.manage.create({
      tenantId: resolveTenantId(),
      name: body.name,
      centerLat: body.centerLat,
      centerLon: body.centerLon,
      radiusKm: body.radiusKm,
      priority: body.priority,
      isActive: body.isActive,
      actor: { userId: claims.sub, role: claims.role },
    })
    return ok(toDeliveryZoneViewDto(zone))
  }

  @Patch(':id')
  @HttpCode(HttpStatus.Ok)
  @Roles('super_admin')
  public async update(
    @Param('id', UUID_PIPE) id: string,
    @Body(new ZodValidationPipe(updateDeliveryZoneRequestSchema)) body: UpdateDeliveryZoneRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<DeliveryZoneViewDto>> {
    const zone = await this.manage.update({
      id,
      tenantId: resolveTenantId(),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.centerLat !== undefined && { centerLat: body.centerLat }),
      ...(body.centerLon !== undefined && { centerLon: body.centerLon }),
      ...(body.radiusKm !== undefined && { radiusKm: body.radiusKm }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      actor: { userId: claims.sub, role: claims.role },
    })
    return ok(toDeliveryZoneViewDto(zone))
  }
}

function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
