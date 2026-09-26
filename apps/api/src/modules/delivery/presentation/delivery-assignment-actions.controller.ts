import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import {
  deliverRequestSchema,
  departToCustomerRequestSchema,
  ok,
  recordCashRequestSchema,
  type DeliverRequest,
  type DepartToCustomerRequest,
  type RecordCashRequest,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { DepartUseCase, type DepartResult } from '../application/use-cases/depart.use-case.js'
import { DepartToCustomerUseCase, type DepartToCustomerResult } from '../application/use-cases/depart-to-customer.use-case.js'
import { RecordCashUseCase, type RecordCashResult } from '../application/use-cases/record-cash.use-case.js'
import { DeliverUseCase, type DeliverResult } from '../application/use-cases/deliver.use-case.js'
import { ReissueHandoverOtpUseCase, type ReissueHandoverOtpResult } from '../application/use-cases/reissue-handover-otp.use-case.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'delivery-assignments', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class DeliveryAssignmentActionsController {
  // eslint-disable-next-line max-params -- 5 DI-инъекций use case'ов, явные @Inject
  public constructor(
    @Inject(DepartUseCase) private readonly depart: DepartUseCase,
    @Inject(DepartToCustomerUseCase) private readonly departToCustomer: DepartToCustomerUseCase,
    @Inject(RecordCashUseCase) private readonly recordCash: RecordCashUseCase,
    @Inject(DeliverUseCase) private readonly deliver: DeliverUseCase,
    @Inject(ReissueHandoverOtpUseCase) private readonly reissueHandoverOtp: ReissueHandoverOtpUseCase,
  ) {}

  @Post(':id/depart')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async departAction(
    @Param('id', UUID_PIPE) assignmentId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<DepartResult>> {
    const result = await this.depart.execute({ assignmentId, userId: claims.sub })
    return ok(result)
  }

  @Post(':id/depart-to-customer')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async departToCustomerAction(
    @Param('id', UUID_PIPE) assignmentId: string,
    @Body(new ZodValidationPipe(departToCustomerRequestSchema)) body: DepartToCustomerRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<DepartToCustomerResult>> {
    const result = await this.departToCustomer.execute({
      assignmentId,
      userId: claims.sub,
      coldChainBagConfirmed: body.coldChainBagConfirmed,
    })
    return ok(result)
  }

  @Post(':id/record-cash')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  @Idempotent()
  public async recordCashAction(
    @Param('id', UUID_PIPE) assignmentId: string,
    @Body(new ZodValidationPipe(recordCashRequestSchema)) body: RecordCashRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<RecordCashResult>> {
    const result = await this.recordCash.execute({
      assignmentId,
      userId: claims.sub,
      collectedDiram: body.collectedDiram,
      changeDiram: body.changeDiram,
    })
    return ok(result)
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.Ok)
  @Roles('courier')
  public async deliverAction(
    @Param('id', UUID_PIPE) assignmentId: string,
    @Body(new ZodValidationPipe(deliverRequestSchema)) body: DeliverRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<DeliverResult>> {
    const result = await this.deliver.execute({ assignmentId, userId: claims.sub, otpCode: body.otpCode })
    return ok(result)
  }

  @Post(':id/reissue-handover-otp')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist', 'support_agent', 'super_admin')
  public async reissueHandoverOtpAction(
    @Param('id', UUID_PIPE) assignmentId: string,
  ): Promise<SuccessEnvelope<ReissueHandoverOtpResult>> {
    const result = await this.reissueHandoverOtp.execute({ assignmentId })
    return ok(result)
  }
}
