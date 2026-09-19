/**
 * `InMemoryOtpCodesRepository` (EP-01, DTJ-015, DTJ-023, DTJ-024) — заглушка для R1.
 *
 * Drizzle-реализация появится, когда БД подключится (STATE-AND-RESUME §5.1).
 * Контракт уже совместим: `findByIdForUpdate`/`markConsumed`/`incrementAttempts`
 * принимают непрозрачный `tx: UnitOfWorkTx` (совместимый с Drizzle `db.transaction`).
 * В InMemory-режиме `tx` игнорируется — `Map`-операции атомарны благодаря
 * однопоточности Node.js.
 */
import { Injectable } from '@nestjs/common'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import {
  OTP_CODES_REPOSITORY,
  type CreateOtpCodeInput,
  type OtpCodeRecord,
  type OtpCodesRepository,
} from '@/modules/auth/application/ports/otp-codes.repository.port.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'

@Injectable()
export class InMemoryOtpCodesRepository implements OtpCodesRepository {
  private readonly rows = new Map<string, OtpCodeRecord>()

  async create(input: CreateOtpCodeInput): Promise<OtpCodeRecord> {
    // `input.id` — обязан прийти от вызывающего (см. JSDoc порта): используется
    // КАК СОЛЬ хеша ДО вызова create, генерировать свой id здесь — дефект
    // (verify перестаёт находить строку по `otpRequestId`).
    const record: OtpCodeRecord = {
      id: input.id,
      tenantId: input.tenantId,
      subjectRef: input.subjectRef,
      purpose: input.purpose,
      codeHash: input.codeHash,
      plainCode: input.plainCode ?? null,
      attempts: 0,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      consumedAt: null,
    }
    this.rows.set(record.id, record)
    return Promise.resolve(record)
  }

  async findById(id: string): Promise<OtpCodeRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }


  async findByIdForUpdate(_tx: UnitOfWorkTx, id: string): Promise<OtpCodeRecord | null> {
    return Promise.resolve(this.rows.get(id) ?? null)
  }

   
  async markConsumed(_tx: UnitOfWorkTx, id: string, now: Date): Promise<void> {
    const row = this.rows.get(id)
    if (row === undefined) {
      return Promise.resolve()
    }
    this.rows.set(id, { ...row, consumedAt: now })
    return Promise.resolve()
  }

   
  async incrementAttempts(_tx: UnitOfWorkTx, id: string): Promise<void> {
    const row = this.rows.get(id)
    if (row === undefined) {
      return Promise.resolve()
    }
    this.rows.set(id, { ...row, attempts: row.attempts + 1 })
    return Promise.resolve()
  }

  async findActiveBySubject(input: {
    readonly tenantId: string
    readonly subjectRef: string
    readonly purpose: 'login' | 'onboarding_contact'
    readonly now: Date
  }): Promise<OtpCodeRecord | null> {
    for (const row of this.rows.values()) {
      if (
        row.tenantId === input.tenantId &&
        row.subjectRef === input.subjectRef &&
        row.purpose === input.purpose &&
        row.consumedAt === null &&
        row.expiresAt.getTime() > input.now.getTime()
      ) {
        return Promise.resolve(row)
      }
    }
    return Promise.resolve(null)
  }

  countBySubjectAndPurpose(tenantId: string, subjectRef: string, purpose: 'delivery_handover'): Promise<number> {
    let count = 0
    for (const row of this.rows.values()) {
      if (row.tenantId === tenantId && row.subjectRef === subjectRef && row.purpose === purpose) {
        count += 1
      }
    }
    return Promise.resolve(count)
  }
}

export { OTP_CODES_REPOSITORY }
