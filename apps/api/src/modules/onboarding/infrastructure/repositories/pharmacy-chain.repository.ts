/**
 * Drizzle-реализация `PharmacyChainRepositoryPort` (DTJ-064). Базовый upsert
 * по первичному ключу `id`; поиск по `tin_inn` использует UNIQUE-индекс
 * (миграция `0008_onboarding_foundation.sql`).
 *
 * Маппинг домен ↔ Drizzle-row — приватная функция `chainFromRow`,
 * аналогично `tenant.repository.ts` (DTJ-052).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, count, eq, isNotNull } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'
import { PharmacyChain } from '@/modules/onboarding/domain/pharmacy-chain.entity.js'
import type {
  ListByStatusFilter,
  ListByStatusResult,
  PharmacyChainRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import { isOnboardingStatus } from '@/modules/onboarding/domain/value-objects/onboarding-status.vo.js'

@Injectable()
export class DrizzlePharmacyChainRepository implements PharmacyChainRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<PharmacyChain | null> {
    const rows = await this.db.select().from(pharmacyChains).where(eq(pharmacyChains.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return chainFromRow(row)
  }

  async findByTinInn(tinInn: string): Promise<PharmacyChain | null> {
    const rows = await this.db
      .select()
      .from(pharmacyChains)
      .where(eq(pharmacyChains.tinInn, tinInn))
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return chainFromRow(row)
  }

  async listByStatus(filter: ListByStatusFilter): Promise<ListByStatusResult> {
    const whereCondition =
      filter.status === undefined
        ? isNotNull(pharmacyChains.submittedAt)
        : and(eq(pharmacyChains.status, filter.status), isNotNull(pharmacyChains.submittedAt))
    const items = await this.db
      .select({
        id: pharmacyChains.id,
        status: pharmacyChains.status,
        submittedAt: pharmacyChains.submittedAt,
        reviewReason: pharmacyChains.tinInn,
        slaTargetAt: pharmacyChains.submittedAt,
      })
      .from(pharmacyChains)
      .where(whereCondition)
      .orderBy(asc(pharmacyChains.submittedAt))
      .limit(filter.limit)
      .offset(filter.offset)
    const totalRows = await this.db
      .select({ value: count() })
      .from(pharmacyChains)
      .where(whereCondition)
    const total = totalRows[0]?.value ?? 0
    return {
      items: items.map((it) => ({
        id: it.id,
        status: it.status,
        submittedAt: it.submittedAt,
        reviewReason: null,
        slaTargetAt: null,
      })),
      total,
    }
  }

  async save(chain: PharmacyChain): Promise<void> {
    const row = chain.props
    await this.db
      .insert(pharmacyChains)
      .values(row)
      .onConflictDoUpdate({
        target: pharmacyChains.id,
        set: {
          name: row.name,
          legalEntityName: row.legalEntityName,
          tinInn: row.tinInn,
          isWhitelabelActive: row.isWhitelabelActive,
          legalAddress: row.legalAddress,
          registrationCertificateUrl: row.registrationCertificateUrl,
          directorFullName: row.directorFullName,
          contactPhone: row.contactPhone,
          bankAccountRef: row.bankAccountRef,
          payoutMerchantRef: row.payoutMerchantRef,
          isWhitelabelRequested: row.isWhitelabelRequested,
          status: row.status,
          submittedAt: row.submittedAt,
          contactPhoneVerified: row.contactPhoneVerified,
          updatedAt: new Date(),
        },
      })
  }
}

/**
 * Drizzle-row → домен. Использует `PharmacyChain.restore()` для приватного
 * конструктора. `status` валидируется через `isOnboardingStatus` гард
 * (на случай повреждения БД).
 */
function chainFromRow(row: typeof pharmacyChains.$inferSelect): PharmacyChain | null {
  if (!isOnboardingStatus(row.status)) {
    return null
  }
  return PharmacyChain.restore({
    id: row.id,
    name: row.name,
    legalEntityName: row.legalEntityName,
    tinInn: row.tinInn,
    directorFullName: row.directorFullName ?? '',
    contactPhone: row.contactPhone ?? '',
    legalAddress: row.legalAddress,
    registrationCertificateUrl: row.registrationCertificateUrl,
    isWhitelabelRequested: row.isWhitelabelRequested,
    isWhitelabelActive: row.isWhitelabelActive ?? false,
    status: row.status,
    contactPhoneVerified: row.contactPhoneVerified,
    submittedAt: row.submittedAt,
    bankAccountRef: row.bankAccountRef,
    payoutMerchantRef: row.payoutMerchantRef,
  })
}
