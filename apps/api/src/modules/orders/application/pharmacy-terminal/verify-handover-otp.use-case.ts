// Единственное место сверки кода вручения — вызывается только через OrdersFacade.verifyHandoverOtp.
import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { HandoverOtpNotFoundError, OtpAttemptsExceededError, OtpExpiredError, OtpMismatchError } from '@dorutj/contracts'
import {
  OTP_CODES_REPOSITORY,
  UNIT_OF_WORK as AUTH_UNIT_OF_WORK,
  type OtpCodesRepository,
  type UnitOfWorkPort as AuthUnitOfWorkPort,
} from '@/modules/auth/index.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
} from '@/modules/orders/application/ports/order-repository.port.js'

const HANDOVER_OTP_VERIFY_MAX_ATTEMPTS = 5 // ASSUMPTION — короткий 4-значный код, строже login (5 тоже, но отдельный счётчик).
const SHA256_HEX_LENGTH = 64

export interface VerifyHandoverOtpCommand {
  readonly orderId: string
  readonly tenantId: string
  readonly candidateCode: string
  readonly now: Date
}

@Injectable()
export class VerifyHandoverOtpUseCase {
  public constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orders: OrderRepositoryPort,
    @Inject(OTP_CODES_REPOSITORY) private readonly otpCodes: OtpCodesRepository,
    @Inject(AUTH_UNIT_OF_WORK) private readonly authUow: AuthUnitOfWorkPort,
  ) {}

  public async execute(cmd: VerifyHandoverOtpCommand): Promise<void> {
    const order = await this.orders.findById(cmd.tenantId, cmd.orderId)
    const handoverOtpId = order?.toSnapshot().handoverOtpId ?? null
    // Не гейтим на order.status — повторный deliver ПОСЛЕ успеха видит order уже 'delivered'; otp_codes.consumed_at ниже отличает «уже использован» от «код не найден».
    if (order === null || handoverOtpId === null) {
      throw new HandoverOtpNotFoundError({ orderId: cmd.orderId })
    }
    await this.authUow.run(async (tx) => {
      const record = await this.otpCodes.findByIdForUpdate(tx, handoverOtpId)
      if (record?.consumedAt !== null) {
        throw new OtpMismatchError()
      }
      if (record.attempts >= HANDOVER_OTP_VERIFY_MAX_ATTEMPTS) {
        throw new OtpAttemptsExceededError({ orderId: cmd.orderId, attempts: record.attempts, max: HANDOVER_OTP_VERIFY_MAX_ATTEMPTS })
      }
      if (cmd.now.getTime() > record.expiresAt.getTime()) {
        await this.otpCodes.incrementAttempts(tx, handoverOtpId)
        throw new OtpExpiredError()
      }
      const candidateHash = hashOtpCode(cmd.candidateCode, handoverOtpId)
      if (candidateHash !== record.codeHash) {
        await this.otpCodes.incrementAttempts(tx, handoverOtpId)
        throw new OtpMismatchError()
      }
      await this.otpCodes.markConsumed(tx, handoverOtpId, cmd.now)
    })
  }
}

function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
}
