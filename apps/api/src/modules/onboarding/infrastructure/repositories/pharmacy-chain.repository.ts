/**
 * Drizzle-реализация `PharmacyChainRepositoryPort` (DTJ-064). Базовый upsert
 * по первичному ключу `id`; поиск по `tin_inn` использует UNIQUE-индекс
 * (миграция `0008_onboarding_foundation.sql`).
 *
 * Маппинг домен ↔ Drizzle-row — приватная функция `chainFromRow`,
 * аналогично `tenant.repository.ts` (DTJ-052).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, count, eq, gt, isNotNull, or, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacyChains } from '@/db/schema/pharmacy-chains.js'
import { PharmacyChain } from '@/modules/onboarding/domain/pharmacy-chain.entity.js'
import type { ListQueueQuery, QueuePage } from '@/modules/onboarding/application/ports/verification-queue.types.js'
import type {
  ListByStatusFilter,
  ListByStatusResult,
  PharmacyChainRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import { isOnboardingStatus } from '@/modules/onboarding/domain/value-objects/onboarding-status.vo.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'
import { toQueuePage } from './verification-queue-page.util.js'

@Injectable()
export class DrizzlePharmacyChainRepository implements PharmacyChainRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(id: string, tx?: unknown): Promise<PharmacyChain | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client.select().from(pharmacyChains).where(eq(pharmacyChains.id, id)).limit(1)
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

  async listQueue(query: ListQueueQuery): Promise<QueuePage> {
    const conditions: SQL[] = [isNotNull(pharmacyChains.submittedAt)]
    if (query.status !== undefined) {
      conditions.push(eq(pharmacyChains.status, query.status))
    }
    if (query.cursor !== null) {
      const anchor = new Date(query.cursor.v)
      const after = or(
        gt(pharmacyChains.submittedAt, anchor),
        and(eq(pharmacyChains.submittedAt, anchor), gt(pharmacyChains.id, query.cursor.id)),
      )
      if (after !== undefined) {
        conditions.push(after)
      }
    }
    const rows = await this.db
      .select({ id: pharmacyChains.id, status: pharmacyChains.status, submittedAt: pharmacyChains.submittedAt })
      .from(pharmacyChains)
      .where(and(...conditions))
      .orderBy(asc(pharmacyChains.submittedAt), asc(pharmacyChains.id))
      .limit(query.limit + 1)
    return toQueuePage(rows.map((row) => ({ ...row, reviewReason: null, slaTargetAt: null })), query.limit)
  }

  async save(chain: PharmacyChain, tx?: unknown): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const row = chain.props
    await client
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
