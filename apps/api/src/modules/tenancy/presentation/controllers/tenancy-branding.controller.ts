import { createHash } from 'node:crypto'
import { Body, Controller, Get, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Put, Req, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ErrorCode, ok, type SuccessEnvelope, type TenantBrandingDto } from '@dorutj/contracts'
import { TenantContext } from '@/common/context/tenant-context.js'
import { Public } from '@/common/decorators/public.decorator.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetBrandingUseCase } from '@/modules/tenancy/application/use-cases/get-branding.use-case.js'
import { UpdateBrandingUseCase } from '@/modules/tenancy/application/use-cases/update-branding.use-case.js'

const HTTP_NOT_MODIFIED = 304
const PUBLIC_CACHE_CONTROL = 'public, max-age=300'
const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ version: '1' })
export class TenancyBrandingController {
  constructor(
    @Inject(GetBrandingUseCase) private readonly getBranding: GetBrandingUseCase,
    @Inject(UpdateBrandingUseCase) private readonly updateBranding: UpdateBrandingUseCase,
  ) {}

  @Get('tenant/branding')
  @Public()
  async get(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const branding = await this.getBranding.execute({ tenantId: resolveTenantId() })
    const body = JSON.stringify(ok(branding))
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`
    reply.header('ETag', etag).header('Cache-Control', PUBLIC_CACHE_CONTROL)
    if (matchesEtag(request.headers['if-none-match'], etag)) {
      reply.status(HTTP_NOT_MODIFIED).send()
      return
    }
    reply.header('Content-Type', 'application/json; charset=utf-8').send(body)
  }

  @Put('admin/tenants/:id/branding')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('pharmacy_admin', 'super_admin')
  async update(
    @Param('id', ID_PARSE_UUID) tenantId: string,
    @Body() rawRequest: unknown,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<TenantBrandingDto>> {
    await this.updateBranding.execute({ tenantId, rawRequest, actor: { role: claims.role, tenantId: claims.tenantId } })
    return ok(await this.getBranding.execute({ tenantId }))
  }
}

// Прокси/сжатие могут сделать валидатор слабым (W/"...") или прислать список.
function matchesEtag(header: string | undefined, etag: string): boolean {
  return header?.split(',').some((candidate) => candidate.trim().replace(/^W\//u, '') === etag) ?? false
}

function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    // Недостижимо при подключённых TenantResolutionMiddleware + TenantScopeGuard.
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
