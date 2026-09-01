/**
 * Drizzle-реализация `PharmacyAccountRepositoryPort` (DTJ-065). Зеркало
 * `pharmacy-chain.repository.ts` (DTJ-064) — те же `findById`/`save` + `chainFromRow`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, asc, count, eq, isNotNull, lte } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import type {
  ListByStatusFilter,
  ListByStatusResult,
  PharmacyAccountRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import { isOnboardingStatus } from '@/modules/onboarding/domain/value-objects/onboarding-status.vo.js'

@Injectable()
export class DrizzlePharmacyAccountRepository implements PharmacyAccountRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<PharmacyAccount | null> {
    const rows = await this.db.select().from(pharmacies).where(eq(pharmacies.id, id)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return accountFromRow(row)
  }

  async listByChain(chainId: string): Promise<readonly PharmacyAccount[]> {
    const rows = await this.db.select().from(pharmacies).where(eq(pharmacies.chainId, chainId))
    const out: PharmacyAccount[] = []
    for (const row of rows) {
      const account = accountFromRow(row)
      if (account !== null) {
        out.push(account)
      }
    }
    return out
  }

  async listByStatus(filter: ListByStatusFilter): Promise<ListByStatusResult> {
    const conditions = []
    if (filter.status === undefined) {
      conditions.push(isNotNull(pharmacies.id))
    } else {
      conditions.push(eq(pharmacies.status, filter.status))
    }
    if (filter.licenseExpiryBefore !== undefined) {
      const thresholdStr: string = formatDate(filter.licenseExpiryBefore) ?? '9999-12-31'
      conditions.push(lte(pharmacies.licenseExpiryDate, thresholdStr))
    }
    const whereCondition = and(...conditions)
    const items = await this.db
      .select({
        id: pharmacies.id,
        status: pharmacies.status,
        licenseNumber: pharmacies.licenseNumber,
        licenseExpiryDate: pharmacies.licenseExpiryDate,
      })
      .from(pharmacies)
      .where(whereCondition)
      .orderBy(asc(pharmacies.licenseExpiryDate))
      .limit(filter.limit)
      .offset(filter.offset)
    const totalRows = await this.db.select({ value: count() }).from(pharmacies).where(whereCondition)
    const total = totalRows[0]?.value ?? 0
    return {
      items: items.map((it) => ({
        id: it.id,
        status: it.status,
        submittedAt: null,
        reviewReason: null,
        slaTargetAt: null,
        licenseNumber: it.licenseNumber,
        licenseExpiryDate: parseDate(it.licenseExpiryDate),
      })),
      total,
    }
  }

  async save(account: PharmacyAccount): Promise<void> {
    const baseRow = this.buildRow(account)
    await this.db.insert(pharmacies).values(baseRow).onConflictDoUpdate({
      target: pharmacies.id,
      set: this.buildUpdateSet(baseRow),
    })
  }

  /** Сборка Drizzle-insert-строки — выделено из `save` для соблюдения C1 `max-lines-per-function`. */
  private buildRow(account: PharmacyAccount): typeof pharmacies.$inferInsert {
    const row = account.props
    return {
      id: row.id,
      chainId: row.chainId,
      name: row.name,
      addressText: row.addressText,
      landmarkTj: row.landmarkTj,
      latitude: String(row.latitude),
      longitude: String(row.longitude),
      phone: row.phone,
      is24_7: row.is24_7,
      openingTime: row.openingTime,
      closingTime: row.closingTime,
      licenseNumber: row.licenseNumber,
      licenseIssuingAuthority: row.licenseIssuingAuthority,
      licenseIssueDate: formatDate(row.licenseIssueDate),
      licenseExpiryDate: formatDate(row.licenseExpiryDate),
      licenseScanUrl: row.licenseScanUrl,
      pharmacistInChargeName: row.pharmacistInChargeName,
      status: row.status,
      suspensionReason: row.suspensionReason,
    }
  }

  /** Только обновляемые колонки для `onConflictDoUpdate.set`. */
  private buildUpdateSet(row: typeof pharmacies.$inferInsert): Partial<typeof pharmacies.$inferInsert> {
    return {
      chainId: row.chainId,
      name: row.name,
      addressText: row.addressText,
      landmarkTj: row.landmarkTj,
      latitude: row.latitude,
      longitude: row.longitude,
      phone: row.phone,
      is24_7: row.is24_7,
      openingTime: row.openingTime,
      closingTime: row.closingTime,
      licenseNumber: row.licenseNumber,
      licenseIssuingAuthority: row.licenseIssuingAuthority,
      licenseIssueDate: row.licenseIssueDate,
      licenseExpiryDate: row.licenseExpiryDate,
      licenseScanUrl: row.licenseScanUrl,
      pharmacistInChargeName: row.pharmacistInChargeName,
      status: row.status,
      suspensionReason: row.suspensionReason,
    }
  }
}

function formatDate(value: Date | string | null): string | null {
  if (value === null) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  return value
}

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null
  }
  return new Date(value)
}

function accountFromRow(row: typeof pharmacies.$inferSelect): PharmacyAccount | null {
  if (!isOnboardingStatus(row.status)) {
    return null
  }
  return PharmacyAccount.restore({
    id: row.id,
    chainId: row.chainId ?? '',
    name: row.name,
    addressText: row.addressText,
    landmarkTj: row.landmarkTj,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    phone: row.phone,
    is24_7: row.is24_7 ?? false,
    openingTime: row.openingTime,
    closingTime: row.closingTime,
    licenseNumber: row.licenseNumber ?? '',
    licenseIssuingAuthority: row.licenseIssuingAuthority,
    licenseIssueDate: parseDate(row.licenseIssueDate),
    licenseExpiryDate: parseDate(row.licenseExpiryDate),
    licenseScanUrl: row.licenseScanUrl,
    pharmacistInChargeName: row.pharmacistInChargeName,
    status: row.status,
    suspensionReason: row.suspensionReason as never,
    isActive: row.isActive ?? true,
    submittedAt: null,
  })
}
