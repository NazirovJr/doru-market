// Переиспользует auth-примитивы OTP_GENERATOR/OTP_CODES_REPOSITORY — не второй механизм выпуска OTP.
import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import {
  OTP_CODES_REPOSITORY,
  OTP_GENERATOR,
  type OtpCodesRepository,
  type OtpGeneratorPort,
} from '@/modules/auth/index.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  isNonTerminalAssignmentStatus,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'

const HANDOVER_OTP_PURPOSE = 'delivery_handover'
const HANDOVER_OTP_TTL_SECONDS = 900
const MILLISECONDS_PER_SECOND = 1000
const SHA256_HEX_LENGTH = 64

export interface ReissueHandoverOtpCommand {
  readonly assignmentId: string
}

export interface ReissueHandoverOtpResult {
  readonly deliveryAssignmentId: string
  readonly code: string
  readonly expiresAt: Date
}

@Injectable()
export class ReissueHandoverOtpUseCase {
  // eslint-disable-next-line max-params -- 7 DI-инъекций, явные @Inject
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(OTP_GENERATOR) private readonly otpGenerator: OtpGeneratorPort,
    @Inject(OTP_CODES_REPOSITORY) private readonly otpCodesRepository: OtpCodesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  public async execute(cmd: ReissueHandoverOtpCommand): Promise<ReissueHandoverOtpResult> {
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null || !isNonTerminalAssignmentStatus(assignment.status) || assignment.handoverOtpId === null) {
      throw new NotFoundError({ resource: 'delivery_assignment_handover_otp', assignmentId: cmd.assignmentId })
    }
    const orderContext = await this.orders.getDeliveryContext(assignment.orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId: assignment.orderId })
    }
    const now = this.clock.now()
    const issued = await this.issueNewHandoverOtp(assignment.orderId, orderContext.tenantId, now)
    return this.uow.run(async (tx) => {
      assignment.setHandoverOtp(issued.id)
      await this.assignments.save(assignment, tx)
      return { deliveryAssignmentId: assignment.id, code: issued.code, expiresAt: issued.expiresAt }
    })
  }

  private async issueNewHandoverOtp(
    orderId: string,
    tenantId: string,
    now: Date,
  ): Promise<{ readonly id: string; readonly code: string; readonly expiresAt: Date }> {
    const id = this.idGenerator.next()
    const { code } = this.otpGenerator.generate(HANDOVER_OTP_PURPOSE)
    const codeHash = hashOtpCode(code, id)
    const expiresAt = new Date(now.getTime() + HANDOVER_OTP_TTL_SECONDS * MILLISECONDS_PER_SECOND)
    await this.otpCodesRepository.create({
      id,
      tenantId,
      subjectRef: orderId,
      purpose: HANDOVER_OTP_PURPOSE,
      codeHash,
      plainCode: code,
      issuedAt: now,
      expiresAt,
    })
    return { id, code, expiresAt }
  }
}

function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
