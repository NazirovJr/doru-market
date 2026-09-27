// rotate/PATCH requireMtls не заведены — блокер миграции pharmacy_api_keys (см. отчёт сдачи).
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, UseGuards, UsePipes } from '@nestjs/common'
import {
  ok,
  RevokePharmacyApiKeyRequestSchema,
  type PharmacyApiKeyCreatedDto,
  type PharmacyApiKeySummaryDto,
  type RevokePharmacyApiKeyRequestDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { CreatePharmacyApiKeyUseCase } from '../application/use-cases/create-pharmacy-api-key.use-case.js'
import { ListPharmacyApiKeysUseCase } from '../application/use-cases/list-pharmacy-api-keys.use-case.js'
import { RevokePharmacyApiKeyUseCase } from '../application/use-cases/revoke-pharmacy-api-key.use-case.js'
import type { CreatedPharmacyApiKeyView, PharmacyApiKeySummaryView } from '../application/ports/inventory-facade.port.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'pharmacy-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin', 'pharmacy_admin')
export class PharmacyApiKeysController {
  public constructor(
    @Inject(CreatePharmacyApiKeyUseCase) private readonly createUseCase: CreatePharmacyApiKeyUseCase,
    @Inject(ListPharmacyApiKeysUseCase) private readonly listUseCase: ListPharmacyApiKeysUseCase,
    @Inject(RevokePharmacyApiKeyUseCase) private readonly revokeUseCase: RevokePharmacyApiKeyUseCase,
  ) {}

  @Post(':id/api-keys')
  public async create(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<PharmacyApiKeyCreatedDto>> {
    const created = await this.createUseCase.execute({
      actor: { role: claims.role, chainId: claims.chainId },
      pharmacyId,
    })
    return ok(toCreatedDto(created))
  }

  @Get(':id/api-keys')
  public async list(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly PharmacyApiKeySummaryDto[]>> {
    const items = await this.listUseCase.execute({
      actor: { role: claims.role, chainId: claims.chainId },
      pharmacyId,
    })
    return ok(items.map(toSummaryDto))
  }

  // eslint-disable-next-line max-params -- 4 HTTP-параметра (:id, :keyId, тело, JWT-claims), каждый со своим Nest-декоратором — тот же приём, что PharmacyTerminalItemsController.scan.
  @Post(':id/api-keys/:keyId/revoke')
  @UsePipes(new ZodValidationPipe(RevokePharmacyApiKeyRequestSchema))
  public async revoke(
    @Param('id', ID_PARSE_UUID) pharmacyId: string,
    @Param('keyId', ID_PARSE_UUID) keyId: string,
    @Body() body: RevokePharmacyApiKeyRequestDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<{ readonly revoked: true }>> {
    await this.revokeUseCase.execute({
      actor: { role: claims.role, chainId: claims.chainId },
      pharmacyId,
      keyId,
      reason: body.reason,
    })
    return ok({ revoked: true })
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
  return { id: view.id, keyPrefix: view.keyPrefix, isActive: view.isActive, createdAt: view.createdAt.toISOString() }
}
