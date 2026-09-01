/**
 * `PharmacyVerificationRevocationController` (DTJ-072) — единственный маршрут
 * `POST /pharmacy-verifications/:id/revoke`. `super_admin` only.
 */
import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { RevokeVerificationRequestSchema, ok, type RevokeVerificationRequest } from '@dorutj/contracts'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import { RevokeVerificationUseCase } from '@/modules/onboarding/application/use-cases/revoke-verification.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

@Controller({ path: 'pharmacy-verifications', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class PharmacyVerificationRevocationController {
  constructor(private readonly revokeVerification: RevokeVerificationUseCase) {}

  @Post(':id/revoke')
  @UsePipes(new ZodValidationPipe(RevokeVerificationRequestSchema))
  async revoke(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: RevokeVerificationRequest,
  ): Promise<unknown> {
    const result = await this.revokeVerification.execute({
      verificationId: id,
      actorId: SYSTEM_ACTOR_ID,
      reason: body.reason,
    })
    return ok(result)
  }
}
