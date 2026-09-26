// OTP-верификация идёт в своей транзакции auth-модуля, отдельно от транзакции delivery.
import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import {
  ForbiddenError,
  HandoverOtpNotFoundError,
  NotFoundError,
  OtpAttemptsExceededError,
  OtpExpiredError,
  OtpMismatchError,
} from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import {
  OTP_CODES_REPOSITORY,
  RATE_LIMIT_CHECKER,
  UNIT_OF_WORK as AUTH_UNIT_OF_WORK,
  type OtpCodesRepository,
  type RateLimitCheckerPort,
  type UnitOfWorkPort as AuthUnitOfWorkPort,
} from '@/modules/auth/index.js'
import type { DeliveryDomainEvent } from '../../domain/delivery-domain-event.js'
import type { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { Courier } from '../../domain/courier.entity.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrderContext, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { DELIVERY_OUTBOX, type DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import {
  DELIVERY_UNIT_OF_WORK,
  type DeliveryUnitOfWorkPort,
} from '../ports/delivery-unit-of-work.port.js'
import {
  COURIER_EARNINGS_REPOSITORY,
  type CourierEarningsRepositoryPort,
} from '../ports/courier-earnings.repository.port.js'

const CASH_PAYMENT_METHOD = 'cash_courier'
const SHA256_HEX_LENGTH = 64
const RATE_LIMITER_KEY_PREFIX = 'handover_otp_verify_attempts'
const HANDOVER_OTP_VERIFY_MAX_ATTEMPTS = 5 // ASSUMPTION — короткий 4-значный код, лимит строже login-овского.
const RATE_LIMIT_WINDOW_SECONDS = 900

export interface DeliverCommand {
  readonly assignmentId: string
  readonly userId: string
  readonly otpCode: string
}

export interface DeliverResult {
  readonly deliveryAssignmentId: string
}

@Injectable()
export class DeliverUseCase {
  // eslint-disable-next-line max-params -- 10 DI-инъекций, явные @Inject (DTJ-001, esbuild/vitest не эмитит design:paramtypes)
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(DELIVERY_OUTBOX) private readonly outbox: DeliveryOutboxPort,
    @Inject(COURIER_EARNINGS_REPOSITORY) private readonly earnings: CourierEarningsRepositoryPort,
    @Inject(DELIVERY_UNIT_OF_WORK) private readonly uow: DeliveryUnitOfWorkPort,
    @Inject(OTP_CODES_REPOSITORY) private readonly otpCodes: OtpCodesRepository,
    @Inject(RATE_LIMIT_CHECKER) private readonly rateLimit: RateLimitCheckerPort,
    @Inject(AUTH_UNIT_OF_WORK) private readonly authUow: AuthUnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  public async execute(cmd: DeliverCommand): Promise<DeliverResult> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
    }
    if (assignment.courierId !== courier.id) {
      throw new ForbiddenError('Delivery assignment does not belong to this courier', { assignmentId: cmd.assignmentId })
    }
    if (assignment.handoverOtpId === null) {
      throw new HandoverOtpNotFoundError({ deliveryAssignmentId: assignment.id })
    }
    const orderContext = await this.orders.getDeliveryContext(assignment.orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId: assignment.orderId })
    }

    await this.assertVerifyAttemptsNotLocked(assignment.id)
    const now = this.clock.now()
    await this.verifyHandoverOtp(assignment.handoverOtpId, cmd.otpCode, now)

    return this.persistDelivery({ assignment, courier, orderContext, now })
  }

  private async persistDelivery(input: {
    readonly assignment: DeliveryAssignment
    readonly courier: Courier
    readonly orderContext: DeliveryOrderContext
    readonly now: Date
  }): Promise<DeliverResult> {
    const { assignment, courier, orderContext, now } = input
    await this.uow.run(async (tx) => {
      const isCashOnDelivery = orderContext.paymentMethod === CASH_PAYMENT_METHOD
      assignment.markDelivered(now, isCashOnDelivery) // CashAmountMismatchError (TC-DELIV-012), ForbiddenTransitionError
      await this.assignments.save(assignment, tx)

      const event: DeliveryDomainEvent = {
        type: 'OrderDeliveredEvent',
        deliveryAssignmentId: assignment.id,
        orderId: assignment.orderId,
        courierId: courier.id,
        deliveredAt: now,
      }
      await this.outbox.append(event, orderContext.tenantId, tx)

      if (courier.chainId === null) {
        await this.earnings.create(
          {
            id: this.ids.next(),
            courierId: courier.id,
            deliveryAssignmentId: assignment.id,
            amountDiram: orderContext.deliveryFeeDiram,
            idempotencyKey: assignment.id,
          },
          tx,
        )
      }
    })
    await this.orders.markOrderDelivered({ orderId: assignment.orderId, tenantId: orderContext.tenantId, now })
    return { deliveryAssignmentId: assignment.id }
  }

  private async assertVerifyAttemptsNotLocked(assignmentId: string): Promise<void> {
    const key = `${RATE_LIMITER_KEY_PREFIX}:${assignmentId}`
    const result = await this.rateLimit.incrementAndGet(key, RATE_LIMIT_WINDOW_SECONDS)
    if (result.count > HANDOVER_OTP_VERIFY_MAX_ATTEMPTS) {
      throw new OtpAttemptsExceededError({ deliveryAssignmentId: assignmentId, attempts: result.count, max: HANDOVER_OTP_VERIFY_MAX_ATTEMPTS })
    }
  }

  // Дубль после успеха: OTP уже consumedAt -> OtpMismatchError, не 500.
  private async verifyHandoverOtp(otpId: string, candidateCode: string, now: Date): Promise<void> {
    await this.authUow.run(async (tx) => {
      const record = await this.otpCodes.findByIdForUpdate(tx, otpId)
      if (record?.consumedAt !== null) {
        throw new OtpMismatchError()
      }
      if (now.getTime() > record.expiresAt.getTime()) {
        await this.otpCodes.incrementAttempts(tx, otpId)
        throw new OtpExpiredError()
      }
      const candidateHash = hashOtpCode(candidateCode, otpId)
      if (candidateHash !== record.codeHash) {
        await this.otpCodes.incrementAttempts(tx, otpId)
        throw new OtpMismatchError()
      }
      await this.otpCodes.markConsumed(tx, otpId, now)
    })
  }
}

function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
