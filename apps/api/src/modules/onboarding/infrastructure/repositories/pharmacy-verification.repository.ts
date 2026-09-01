/**
 * Drizzle-реализация `PharmacyVerificationRepositoryPort` (DTJ-066). Создание
 * первой записи `pharmacy_verification` для субъекта (chain или pharmacy) —
 * только при переходе в `pending_review`. Поиск активной/последней записи —
 * для обогащения `ListPendingVerificationsUseCase` (DTJ-067) и `OnboardingFacade` (DTJ-070).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
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
    if (input.chainId !== undefined) {
      const rows = await this.db
        .select()
        .from(pharmacyVerification)
        .where(eq(pharmacyVerification.chainId, input.chainId))
        .limit(1)
      return rows[0] ?? null
    }
    if (input.pharmacyId !== undefined) {
      const rows = await this.db
        .select()
        .from(pharmacyVerification)
        .where(eq(pharmacyVerification.pharmacyId, input.pharmacyId))
        .limit(1)
      return rows[0] ?? null
    }
    return null
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
    const inserted = await this.db
      .insert(pharmacyVerification)
      .values({
        pharmacyId: row.pharmacyId ?? null,
        chainId: row.chainId ?? null,
        verificationStatus: row.verificationStatus,
        submittedAt: row.submittedAt ?? null,
        slaTargetAt: row.slaTargetAt ?? null,
        reviewReason: row.reviewReason ?? 'initial',
      })
      .returning()
    const result = inserted[0]
    if (result === undefined) {
      throw new Error('PharmacyVerification insert returned no row')
    }
    return result
  }
}
