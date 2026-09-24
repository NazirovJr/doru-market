import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { endCourierShiftRequestSchema, ok, type EndCourierShiftRequest, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { StartCourierShiftUseCase } from '../application/use-cases/start-courier-shift.use-case.js'
import { EndCourierShiftUseCase } from '../application/use-cases/end-courier-shift.use-case.js'
import { toCourierShiftViewDto, type CourierShiftViewDto } from './courier-shift-view.dto.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'courier-shifts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class CourierShiftsController {
  public constructor(
    @Inject(StartCourierShiftUseCase) private readonly startShift: StartCourierShiftUseCase,
    @Inject(EndCourierShiftUseCase) private readonly endShift: EndCourierShiftUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Created)
  @Roles('courier')
  public async start(@CurrentUser() claims: JwtClaims): Promise<SuccessEnvelope<CourierShiftViewDto>> {
    const snapshot = await this.startShift.execute(claims.sub)
    return ok(toCourierShiftViewDto(snapshot))
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async end(
    @Param('id', UUID_PIPE) shiftId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(endCourierShiftRequestSchema)) body: EndCourierShiftRequest,
  ): Promise<SuccessEnvelope<CourierShiftViewDto>> {
    const snapshot = await this.endShift.execute({
      userId: claims.sub,
      shiftId,
      cashSubmittedDiram: BigInt(body.cashSubmittedDiram),
    })
    return ok(toCourierShiftViewDto(snapshot))
  }
}
