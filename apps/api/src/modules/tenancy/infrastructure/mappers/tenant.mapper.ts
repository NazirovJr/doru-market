/**
 * Маппер между Drizzle-row `tenants` и доменным `Tenant` (DTJ-052). Чистая
 * функция без побочных эффектов — тестируется unit-тестом без БД.
 *
 * `application`/`domain` НЕ импортируют этот файл (см. `02` §1.1), только
 * `infrastructure/repositories/tenant.repository.ts`.
 */
import { Tenant } from '@/modules/tenancy/domain/tenant.entity.js'
import { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'
import { TenantSlug } from '@/modules/tenancy/domain/value-objects/tenant-slug.vo.js'
import { TenantSettings } from '@/modules/tenancy/domain/tenant-settings.entity.js'
import { type tenants, type tenantSettings } from '@/db/schema/tenants.js'

type TenantRow = typeof tenants.$inferSelect
type TenantSettingsRow = typeof tenantSettings.$inferSelect

interface TenantPersistenceInput {
  tenant: Tenant
  settings: TenantSettings
}

export function tenantFromDb(row: TenantRow, settingsRow: TenantSettingsRow | null): Tenant | null {
  if (settingsRow === null) {
    // Без settings агрегат не консистентен — пропускаем, репозиторий вернёт null.
    return null
  }
  return Tenant.restore({
    id: TenantId.from(row.id),
    slug: TenantSlug.parse(row.slug),
    isNeutral: row.isNeutral,
    chainId: row.chainId !== null ? TenantId.from(row.chainId) : null,
    customDomain: row.customDomain,
    customDomainStatus: row.customDomainStatus as Tenant['customDomainStatus']['value'],
    domainVerificationToken: row.domainVerificationToken,
    settings: settingsRowToDomain(settingsRow),
    courierSourcingMode: row.courierSourcingMode as Tenant['courierSourcingMode']['value'],
  })
}

function settingsRowToDomain(row: TenantSettingsRow): TenantSettings {
  return TenantSettings.restore({
    brandName: row.brandName,
    brandPalette: row.brandPalette as Readonly<Record<string, string>>,
    brandLogoUrl: row.brandLogoUrl,
    merchantCredentialsRef: row.merchantCredentialsRef,
    telegramBotTokenRef: row.telegramBotTokenRef,
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
  })
}

/**
 * Маппинг доменного `Tenant` → Drizzle-insert для таблицы `tenants` (DTJ-052).
 * Выделено из `toTenantInsert` для соблюдения C1 `max-lines-per-function`.
 */
function buildTenantInsert(input: TenantPersistenceInput): typeof tenants.$inferInsert {
  const tenant = input.tenant
  return {
    id: tenant.id.value,
    slug: tenant.slug.value,
    chainId: tenant.chainId?.value ?? null,
    customDomain: tenant.customDomain,
    isNeutral: tenant.isNeutral,
    courierSourcingMode: tenant.courierSourcingMode.value,
    customDomainStatus: tenant.customDomainStatus.value,
    domainVerificationToken: tenant.domainVerificationToken,
  }
}

/**
 * Маппинг доменного `TenantSettings` → Drizzle-insert для таблицы `tenant_settings`.
 * Поля с NULL-дефолтами для брендинга (logo_square, favicon, telegram bot username и пр.)
 * сейчас не настраиваются через UI Wave 2 (см. 26-module-tenancy-whitelabel.md §4),
 * но Drizzle-схема требует NOT NULL DEFAULT — прокидываем явный `null`.
 */
function buildTenantSettingsInsert(input: TenantPersistenceInput): typeof tenantSettings.$inferInsert {
  const { tenant, settings } = input
  return {
    tenantId: tenant.id.value,
    brandName: settings.brandName,
    brandLogoUrl: settings.brandLogoUrl,
    brandLogoSquareUrl: null,
    brandFaviconUrl: null,
    brandPalette: settings.brandPalette,
    telegramBotUsername: null,
    telegramBotTokenRef: settings.telegramBotTokenRef,
    merchantCredentialsRef: settings.merchantCredentialsRef,
    merchantCredentialsStatus: 'not_configured',
    supportPhone: null,
    supportEmail: null,
    codLimitDiram: settings.codLimitDiram,
    holdPeriodDays: settings.holdPeriodDays,
    pickupSlaMinutes: settings.pickupSlaMinutes,
    pickupSlaBufferMinutes: settings.pickupSlaBufferMinutes,
    deliverySlaCityMinutes: settings.deliverySlaCityMinutes,
    deliverySlaRemoteMinutes: settings.deliverySlaRemoteMinutes,
    disputeWindowHours: settings.disputeWindowHours,
    inventoryDeltaSlaMinutes: settings.inventoryDeltaSlaMinutes,
    returnRestockMinRemainingDays: settings.returnRestockMinRemainingDays,
    defaultLocale: settings.defaultLocale,
  }
}

/**
 * Двунаправленная часть: превращение доменного `Tenant`+`TenantSettings` в плоский
 * набор полей для upsert. Используется `save(tenant, settings)` репозитория.
 */
export function toTenantInsert(input: TenantPersistenceInput): {
  tenant: typeof tenants.$inferInsert
  settings: typeof tenantSettings.$inferInsert
} {
  return {
    tenant: buildTenantInsert(input),
    settings: buildTenantSettingsInsert(input),
  }
}
