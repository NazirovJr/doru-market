/**
 * Drizzle `OtpCodesRepository` (EP-01, DTJ-015/023/024, волна 5 блок A).
 *
 * Подключается вместо `InMemoryOtpCodesRepository`, когда доступна Postgres
 * (production / docker-compose). `findByIdForUpdate`/`markConsumed`/
 * `incrementAttempts` получают `tx` из `UnitOfWorkPort.run(...)`
 * (`DrizzleUnitOfWorkAdapter`) — используют ЕГО через `resolveDrizzleClient`,
 * а не дефолтный пул `this.db`, иначе `SELECT ... FOR UPDATE` не держит
 * блокировку строки внутри транзакции verify (SRS-API-071).
 *
 * `create(input)` — вызывается из `RequestOtpUseCase` ВНЕ `uow.run` (порт не
 * принимает `tx`, см. JSDoc `OtpCodesRepository.create`), всегда на `this.db`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { otpCodes, type OtpCodeRow } from '@/db/schema/otp-codes.js'
import {
  OTP_CODES_REPOSITORY,
  type CreateOtpCodeInput,
  type OtpCodeRecord,
  type OtpCodesRepository,
} from '@/modules/auth/application/ports/otp-codes.repository.port.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzleOtpCodesRepository implements OtpCodesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async create(input: CreateOtpCodeInput): Promise<OtpCodeRecord> {
    const rows = await this.db
      .insert(otpCodes)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        subjectRef: input.subjectRef,
        purpose: input.purpose,
        codeHash: input.codeHash,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) {
      throw new Error('otp_codes insert returned no rows')
    }
    return rowToRecord(row)
  }

  async findByIdForUpdate(tx: UnitOfWorkTx, id: string): Promise<OtpCodeRecord | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client.select().from(otpCodes).where(eq(otpCodes.id, id)).for('update')
    const row = rows[0]
    return row === undefined ? null : rowToRecord(row)
  }

  async markConsumed(tx: UnitOfWorkTx, id: string, now: Date): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, id))
  }

  async incrementAttempts(tx: UnitOfWorkTx, id: string): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, id))
  }

  async findActiveBySubject(input: {
    readonly tenantId: string
    readonly subjectRef: string
    readonly purpose: 'login' | 'onboarding_contact'
    readonly now: Date
  }): Promise<OtpCodeRecord | null> {
    const rows = await this.db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.tenantId, input.tenantId),
          eq(otpCodes.subjectRef, input.subjectRef),
          eq(otpCodes.purpose, input.purpose),
          isNull(otpCodes.consumedAt),
          gt(otpCodes.expiresAt, input.now),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : rowToRecord(row)
  }
}

function rowToRecord(row: OtpCodeRow): OtpCodeRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    subjectRef: row.subjectRef,
    purpose: row.purpose as OtpCodeRecord['purpose'],
    codeHash: row.codeHash,
    attempts: row.attempts,
    issuedAt: toDate(row.issuedAt),
    expiresAt: toDate(row.expiresAt),
    consumedAt: row.consumedAt === null ? null : toDate(row.consumedAt),
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

export { OTP_CODES_REPOSITORY }
