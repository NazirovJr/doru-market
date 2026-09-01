/**
 * Drizzle-реализация `TenantRepositoryPort` (DTJ-052).
 *
 * ВАЖНО: класс НЕ наследует `TenantScopedRepository` (DTJ-056) — `tenants`/
 * `tenant_settings` определяют сами тенанты, тенант-скоуп неприменим по
 * определению. Это ЕДИНСТВЕННОЕ намеренное исключение в модуле `tenancy`,
 * зафиксировано явным комментарием здесь и в DTJ-052.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DuplicateCustomDomainError } from '@dorutj/contracts'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { tenants, tenantSettings } from '@/db/schema/tenants.js'
import type { Tenant } from '@/modules/tenancy/domain/tenant.entity.js'
import type { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'
import type { TenantRepositoryPort } from '@/modules/tenancy/application/ports/tenant-repository.port.js'
import { tenantFromDb, toTenantInsert } from '@/modules/tenancy/infrastructure/mappers/tenant.mapper.js'

/** Код SQLSTATE для unique_violation в PostgreSQL. */
const POSTGRES_UNIQUE_VIOLATION = '23505'

@Injectable()
export class DrizzleTenantRepository implements TenantRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findById(id: TenantId): Promise<Tenant | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id.value)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    const settingsRows = await this.db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, id.value))
      .limit(1)
    return tenantFromDb(row, settingsRows[0] ?? null)
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return this.findById(row.id as unknown as TenantId)
  }

  async findByCustomDomain(domain: string): Promise<Tenant | null> {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.customDomain, domain))
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return this.findById(row.id as unknown as TenantId)
  }

  async findByChainId(chainId: TenantId): Promise<Tenant | null> {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.chainId, chainId.value))
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return this.findById(row.id as unknown as TenantId)
  }

  async save(tenant: Tenant): Promise<void> {
    // `save` — upsert (см. DTJ-052 DoD п.2). TenantSettings всегда сохраняется вместе,
    // потому что агрегат `Tenant` его содержит (контракт: вызывающий передаёт
    // `tenant.settings` явно, чтобы избежать двух разных `save`-методов).
    // Здесь используется `tenant.settings` напрямую — это сознательное упрощение для
    // единственного места записи (ProvisioningUseCase). Расширение на 2-методный
    // интерфейс — при появлении отдельных операций над `settings`.
    const inserts = toTenantInsert({ tenant, settings: tenant.settings })
    try {
      await this.upsertTenant(inserts.tenant)
      await this.upsertTenantSettings(inserts.settings)
    } catch (error: unknown) {
      if (isPostgresError(error) && error.code === POSTGRES_UNIQUE_VIOLATION) {
        // `unique_custom_domain` сработал → `DuplicateCustomDomainError`
        // (для `slug`/`chain`/`is_neutral` конфликты отлавливаются в use case
        //  через `findBy*` ДО `save`, см. DTJ-052 риск «save как upsert»).
        if (error.constraint?.includes('custom_domain') === true) {
          throw new DuplicateCustomDomainError({ domain: tenant.customDomain ?? undefined })
        }
      }
      throw error
    }
  }

  /** Upsert строки в `tenants` — выделено из `save` для соблюдения C1 `max-lines-per-function`. */
  private async upsertTenant(row: typeof tenants.$inferInsert): Promise<void> {
    await this.db
      .insert(tenants)
      .values(row)
      .onConflictDoUpdate({
        target: tenants.id,
        set: {
          slug: row.slug,
          customDomain: row.customDomain,
          isNeutral: row.isNeutral,
          courierSourcingMode: row.courierSourcingMode,
          customDomainStatus: row.customDomainStatus,
          domainVerificationToken: row.domainVerificationToken,
          chainId: row.chainId,
        },
      })
  }

  /** Upsert строки в `tenant_settings` — выделено из `save` для соблюдения C1 `max-lines-per-function`. */
  private async upsertTenantSettings(row: typeof tenantSettings.$inferInsert): Promise<void> {
    await this.db
      .insert(tenantSettings)
      .values(row)
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          brandName: row.brandName,
          brandLogoUrl: row.brandLogoUrl,
          brandLogoSquareUrl: row.brandLogoSquareUrl,
          brandFaviconUrl: row.brandFaviconUrl,
          brandPalette: row.brandPalette,
          telegramBotUsername: row.telegramBotUsername,
          telegramBotTokenRef: row.telegramBotTokenRef,
          merchantCredentialsRef: row.merchantCredentialsRef,
          merchantCredentialsStatus: row.merchantCredentialsStatus,
          supportPhone: row.supportPhone,
          supportEmail: row.supportEmail,
          codLimitDiram: row.codLimitDiram,
          holdPeriodDays: row.holdPeriodDays,
          pickupSlaMinutes: row.pickupSlaMinutes,
          pickupSlaBufferMinutes: row.pickupSlaBufferMinutes,
          deliverySlaCityMinutes: row.deliverySlaCityMinutes,
          deliverySlaRemoteMinutes: row.deliverySlaRemoteMinutes,
          disputeWindowHours: row.disputeWindowHours,
          inventoryDeltaSlaMinutes: row.inventoryDeltaSlaMinutes,
          returnRestockMinRemainingDays: row.returnRestockMinRemainingDays,
          defaultLocale: row.defaultLocale,
          updatedAt: new Date(),
        },
      })
  }
}

function isPostgresError(error: unknown): error is { code: string; constraint?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error).code === 'string'
  )
}
