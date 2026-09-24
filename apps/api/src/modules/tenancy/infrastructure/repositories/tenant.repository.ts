/**
 * Drizzle-реализация `TenantRepositoryPort` (DTJ-052).
 *
 * ВАЖНО: класс НЕ наследует `TenantScopedRepository` (DTJ-056) — `tenants`/
 * `tenant_settings` определяют сами тенанты, тенант-скоуп неприменим по
 * определению. Это ЕДИНСТВЕННОЕ намеренное исключение в модуле `tenancy`,
 * зафиксировано явным комментарием здесь и в DTJ-052.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm'
import { DuplicateCustomDomainError } from '@dorutj/contracts'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { tenants, tenantSettings } from '@/db/schema/tenants.js'
import type { Tenant } from '@/modules/tenancy/domain/tenant.entity.js'
import type { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'
import type {
  TenantListItem,
  TenantRepositoryPort,
  TenantsListCursor,
  TenantsListPage,
  TenantsListQuery,
} from '@/modules/tenancy/application/ports/tenant-repository.port.js'
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
    return this.attachSettings(row)
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    return this.attachSettings(row)
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
    return this.attachSettings(row)
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
    return this.attachSettings(row)
  }

  async list(query: TenantsListQuery): Promise<TenantsListPage> {
    const cursorCondition = query.cursor != null ? keysetCondition(query.cursor) : undefined
    const rows = await this.db
      .select()
      .from(tenants)
      .where(cursorCondition)
      .orderBy(desc(tenants.createdAt), desc(tenants.id))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    const settingsByTenantId = await this.loadSettingsByTenantId(page.map((row) => row.id))
    const items = buildListItems(page, settingsByTenantId)
    const last = page[page.length - 1]
    return {
      items,
      nextCursor: hasMore && last !== undefined ? { v: normalizeCreatedAt(last.createdAt).toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  private async loadSettingsByTenantId(tenantIds: readonly string[]): Promise<Map<string, typeof tenantSettings.$inferSelect>> {
    if (tenantIds.length === 0) {
      return new Map()
    }
    const rows = await this.db.select().from(tenantSettings).where(inArray(tenantSettings.tenantId, tenantIds))
    return new Map(rows.map((row) => [row.tenantId, row]))
  }

  /**
   * Догружает `tenant_settings` для уже прочитанной строки `tenants` и собирает агрегат
   * маппером `tenantFromDb`.
   *
   * ИСПРАВЛЕНИЕ (см. отчёт сдачи): раньше `findBySlug`/`findByCustomDomain`/`findByChainId`
   * звали `this.findById(row.id as unknown as TenantId)` — `row.id` это сырая `string`
   * (колонка `tenants.id` без `.$type<TenantId>()`), приведение типа НЕ создавало `TenantId`,
   * а просто врало компилятору. Внутри `findById` это било в `eq(tenants.id, id.value)` —
   * у строки нет `.value`, что даёт `id.value === undefined`, `WHERE id = NULL` никогда не
   * матчит строку. `TenantResolutionMiddleware` дергает эти три метода на каждом HTTP-запросе —
   * ни один тенант не резолвился на живом Postgres.
   *
   * Здесь `row` уже прочитана из `tenants` — второй проход в эту таблицу через `findById`
   * не нужен, только `TenantId.from(row.id)` для валидации UUID внутри `tenantFromDb`
   * (валидирует сам маппер). Достаточно догрузить `tenant_settings` по `row.id` напрямую —
   * это убирает лишний round-trip к `tenants` на каждый вызов `findBySlug`/`findByCustomDomain`/
   * `findByChainId` (было 2 запроса, стало 2 запроса вместо потенциальных 3: `tenants` уже
   * прочитан здесь, второй `tenants`-запрос из `findById` был чистым дублированием).
   */
  private async attachSettings(row: typeof tenants.$inferSelect): Promise<Tenant | null> {
    const settingsRows = await this.db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, row.id))
      .limit(1)
    return tenantFromDb(row, settingsRows[0] ?? null)
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

function keysetCondition(cursor: TenantsListCursor): SQL | undefined {
  const anchorCreatedAt = new Date(cursor.v)
  return or(lt(tenants.createdAt, anchorCreatedAt), and(eq(tenants.createdAt, anchorCreatedAt), lt(tenants.id, cursor.id)))
}

function buildListItems(
  rows: readonly (typeof tenants.$inferSelect)[],
  settingsByTenantId: ReadonlyMap<string, typeof tenantSettings.$inferSelect>,
): readonly TenantListItem[] {
  const items: TenantListItem[] = []
  for (const row of rows) {
    const settingsRow = settingsByTenantId.get(row.id) ?? null
    const tenant = tenantFromDb(row, settingsRow)
    if (tenant !== null) {
      items.push({ tenant, createdAt: normalizeCreatedAt(row.createdAt) })
    }
  }
  return items
}

// created_at приходит от pg то Date, то строкой — new Date(x) принимает оба варианта.
function normalizeCreatedAt(value: Date | string | null): Date {
  return value === null ? new Date(0) : new Date(value)
}
