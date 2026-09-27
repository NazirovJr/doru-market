import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common'
import {
  ok,
  RevokePharmacyApiKeyRequestSchema,
  SetPharmacyApiKeyMtlsRequestSchema,
  type PharmacyApiKeyCreatedDto,
  type PharmacyApiKeySummaryDto,
  type RevokePharmacyApiKeyRequestDto,
  type SetPharmacyApiKeyMtlsRequestDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { RequestContext } from '@/common/context/request-context.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { CreatePharmacyApiKeyUseCase } from '../application/use-cases/create-pharmacy-api-key.use-case.js'
import { ListPharmacyApiKeysUseCase } from '../application/use-cases/list-pharmacy-api-keys.use-case.js'
import { RevokePharmacyApiKeyUseCase } from '../application/use-cases/revoke-pharmacy-api-key.use-case.js'
import { RotatePharmacyApiKeyUseCase } from '../application/use-cases/rotate-pharmacy-api-key.use-case.js'
import { SetPharmacyApiKeyMtlsUseCase } from '../application/use-cases/set-pharmacy-api-key-mtls.use-case.js'
import type { CreatedPharmacyApiKeyView, PharmacyApiKeySummaryView } from '../application/ports/inventory-facade.port.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'pharmacy-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin', 'pharmacy_admin')
export class PharmacyApiKeysController {
  // eslint-disable-next-line max-params -- DI: 5 use case'ов, 1:1 с эндпоинтами, приём UsersAdminController.
  public constructor(
    @Inject(CreatePharmacyApiKeyUseCase) private readonly createUseCase: CreatePharmacyApiKeyUseCase,
    @Inject(ListPharmacyApiKeysUseCase) private readonly listUseCase: ListPharmacyApiKeysUseCase,
    @Inject(RevokePharmacyApiKeyUseCase) private readonly revokeUseCase: RevokePharmacyApiKeyUseCase,
    @Inject(RotatePharmacyApiKeyUseCase) private readonly rotateUseCase: RotatePharmacyApiKeyUseCase,
    @Inject(SetPharmacyApiKeyMtlsUseCase) private readonly setMtlsUseCase: SetPharmacyApiKeyMtlsUseCase,
  ) {}

  @Post(':id/api-keys')
  public async create(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<PharmacyApiKeyCreatedDto>> {
    const created = await this.createUseCase.execute({
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
      pharmacyId,
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(toCreatedDto(created))
  }

  @Get(':id/api-keys')
  public async list(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly PharmacyApiKeySummaryDto[]>> {
    const items = await this.listUseCase.execute({
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
      pharmacyId,
    })
    return ok(items.map(toSummaryDto))
  }

  // eslint-disable-next-line max-params -- 4 HTTP-параметра (:id, :keyId, тело, JWT-claims), каждый со своим Nest-декоратором — тот же приём, что PharmacyTerminalItemsController.scan.
  @Post(':id/api-keys/:keyId/revoke')
  public async revoke(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @Param('keyId', ID_PARSE_UUID) keyId: string,
    @Body(new ZodValidationPipe(RevokePharmacyApiKeyRequestSchema)) body: RevokePharmacyApiKeyRequestDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<{ readonly revoked: true }>> {
    await this.revokeUseCase.execute({
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
      pharmacyId,
      keyId,
      reason: body.reason,
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok({ revoked: true })
  }

  @Post(':id/api-keys/:keyId/rotate')
  @Idempotent()
  public async rotate(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @Param('keyId', ID_PARSE_UUID) oldKeyId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<PharmacyApiKeyCreatedDto>> {
    const rotated = await this.rotateUseCase.execute({
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
      pharmacyId,
      oldKeyId,
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(toCreatedDto(rotated))
  }

  // eslint-disable-next-line max-params -- 4 HTTP-параметра (:id, :keyId, тело, JWT-claims), тот же приём, что revoke выше.
  @Patch(':id/api-keys/:keyId')
  @HttpCode(HttpStatus.OK)
  public async setRequireMtls(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @Param('keyId', ID_PARSE_UUID) keyId: string,
    @Body(new ZodValidationPipe(SetPharmacyApiKeyMtlsRequestSchema)) body: SetPharmacyApiKeyMtlsRequestDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<PharmacyApiKeySummaryDto>> {
    const updated = await this.setMtlsUseCase.execute({
      actor: { userId: claims.sub, role: claims.role, chainId: claims.chainId },
      pharmacyId,
      keyId,
      requireMtls: body.requireMtls,
    })
    return ok(toSummaryDto(updated))
  }
}

function toCreatedDto(view: CreatedPharmacyApiKeyView): PharmacyApiKeyCreatedDto {
  return {
    id: view.id,
    apiKey: `${view.keyPrefix}.${view.secret}`,
    hmacSecret: view.secret,
    keyPrefix: view.keyPrefix,
    createdAt: view.createdAt.toISOString(),
  }
}

function toSummaryDto(view: PharmacyApiKeySummaryView): PharmacyApiKeySummaryDto {
  return {
    id: view.id,
    keyPrefix: view.keyPrefix,
    isActive: view.isActive,
    requireMtls: view.requireMtls,
    createdAt: view.createdAt.toISOString(),
    lastUsedAt: view.lastUsedAt === null ? null : view.lastUsedAt.toISOString(),
    revokedAt: view.revokedAt === null ? null : view.revokedAt.toISOString(),
  }
}
