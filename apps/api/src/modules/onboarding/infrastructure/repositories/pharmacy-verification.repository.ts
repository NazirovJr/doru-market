/**
 * Drizzle-реализация `PharmacyVerificationRepositoryPort` (DTJ-066). Создание
 * первой записи `pharmacy_verification` для субъекта (chain или pharmacy) —
 * только при переходе в `pending_review`. Поиск активной/последней записи —
 * для обогащения `ListPendingVerificationsUseCase` (DTJ-067) и `OnboardingFacade` (DTJ-070).
 */
import { Inject, Injectable } from '@nestjs/common'
import { desc, eq, sql, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyVerification } from '@/db/schema/pharmacy-verification.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type FindBySubjectInput,
  type PharmacyVerificationInsert,
  type PharmacyVerificationRepositoryPort,
  type PharmacyVerificationRow,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'

export { PHARMACY_VERIFICATION_REPOSITORY }

/** Вспомогательная константа — статусы «не рассмотрено» (для DTJ-067). */
export const PENDING_REVIEW_STATUSES = ['pending_review', 'changes_requested'] as const

@Injectable()
export class DrizzlePharmacyVerificationRepository implements PharmacyVerificationRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findBySubject(input: FindBySubjectInput): Promise<PharmacyVerificationRow | null> {
    const subject = subjectCondition(input)
    if (subject === null) {
      return null
    }
    const rows = await this.db
      .select()
      .from(pharmacyVerification)
      .where(subject)
      .orderBy(sql`${pharmacyVerification.submittedAt} desc nulls last`, desc(pharmacyVerification.id))
      .limit(1)
    return rows[0] ?? null
  }

  async findById(id: string): Promise<PharmacyVerificationRow | null> {
    const rows = await this.db
      .select()
      .from(pharmacyVerification)
      .where(eq(pharmacyVerification.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  async save(row: PharmacyVerificationInsert): Promise<PharmacyVerificationRow> {
    const values = toValues(row)
    const saved = await this.db
      .insert(pharmacyVerification)
      .values(row.id === undefined ? values : { id: row.id, ...values })
      .onConflictDoUpdate({ target: pharmacyVerification.id, set: values })
      .returning()
    const result = saved[0]
    if (result === undefined) {
      throw new Error('PharmacyVerification upsert returned no row')
    }
    return result
  }
}

function subjectCondition(input: FindBySubjectInput): SQL | null {
  if (input.chainId !== undefined) {
    return eq(pharmacyVerification.chainId, input.chainId)
  }
  return input.pharmacyId === undefined ? null : eq(pharmacyVerification.pharmacyId, input.pharmacyId)
}

function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null
}

function toValues(row: PharmacyVerificationInsert): Omit<typeof pharmacyVerification.$inferInsert, 'id'> {
  return {
    pharmacyId: orNull(row.pharmacyId),
    chainId: orNull(row.chainId),
    verificationStatus: row.verificationStatus,
    checklistSnapshot: orNull(row.checklistSnapshot),
    submittedAt: orNull(row.submittedAt),
    reviewedBy: orNull(row.reviewedBy),
    reviewedAt: orNull(row.reviewedAt),
    slaTargetAt: orNull(row.slaTargetAt),
    reviewReason: row.reviewReason ?? 'initial',
    revokedAt: orNull(row.revokedAt),
    revokedReason: orNull(row.revokedReason),
    revokedBy: orNull(row.revokedBy),
  }
}
