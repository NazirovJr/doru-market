/**
 * `PharmacyVerificationRepositoryPort` (DTJ-066) — application-уровень контракта
 * доступа к `pharmacy_verification`. Drizzle-реализация — в
 * `infrastructure/repositories/pharmacy-verification.repository.ts`.
 */
export const PHARMACY_VERIFICATION_REPOSITORY = Symbol.for('@dorutj/onboarding/pharmacy-verification-repository')

export interface PharmacyVerificationRow {
  readonly id: string
  readonly pharmacyId: string | null
  readonly chainId: string | null
  readonly verificationStatus: string
  readonly checklistSnapshot: unknown
  readonly submittedAt: Date | null
  readonly reviewedBy: string | null
  readonly reviewedAt: Date | null
  readonly slaTargetAt: Date | null
  readonly reviewReason: string
  readonly revokedAt: Date | null
  readonly revokedReason: string | null
  readonly revokedBy: string | null
}

export interface PharmacyVerificationInsert {
  readonly id?: string
  readonly pharmacyId?: string | null
  readonly chainId?: string | null
  readonly verificationStatus: string
  readonly checklistSnapshot?: unknown
  readonly submittedAt?: Date | null
  readonly reviewedBy?: string | null
  readonly reviewedAt?: Date | null
  readonly slaTargetAt?: Date | null
  readonly reviewReason?: string
  readonly revokedAt?: Date | null
  readonly revokedReason?: string | null
  readonly revokedBy?: string | null
}

export interface FindBySubjectInput {
  readonly chainId?: string
  readonly pharmacyId?: string
}

export interface PharmacyVerificationRepositoryPort {
  findById(id: string): Promise<PharmacyVerificationRow | null>
  findBySubject(input: FindBySubjectInput): Promise<PharmacyVerificationRow | null>
  save(row: PharmacyVerificationInsert): Promise<PharmacyVerificationRow>
}
