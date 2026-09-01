/**
 * Drizzle-реализация `TenantSettingsRepositoryPort` (DTJ-052). Зеркало
 * `tenant.repository.ts`, но для value entity. Тоже НЕ наследует
 * `TenantScopedRepository` (по тем же причинам — это `tenants` определяют
 * тенант, не наоборот).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { tenantSettings } from '@/db/schema/tenants.js'
import type { TenantId } from '@/modules/tenancy/domain/value-objects/tenant-id.vo.js'
import { TenantSettings } from '@/modules/tenancy/domain/tenant-settings.entity.js'
import type { TenantSettingsRepositoryPort } from '@/modules/tenancy/application/ports/tenant-settings-repository.port.js'

@Injectable()
export class DrizzleTenantSettingsRepository implements TenantSettingsRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findByTenantId(tenantId: TenantId): Promise<TenantSettings | null> {
    const rows = await this.db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId.value))
      .limit(1)
    const row = rows[0]
    if (row === undefined) {
      return null
    }
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

  async save(settings: TenantSettings, tenantId: TenantId): Promise<void> {
    const baseRow = this.buildRow(settings, tenantId)
    await this.db
      .insert(tenantSettings)
      .values(baseRow)
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: {
          brandName: baseRow.brandName,
          brandLogoUrl: baseRow.brandLogoUrl,
          brandPalette: baseRow.brandPalette,
          telegramBotTokenRef: baseRow.telegramBotTokenRef,
          merchantCredentialsRef: baseRow.merchantCredentialsRef,
          codLimitDiram: baseRow.codLimitDiram,
          holdPeriodDays: baseRow.holdPeriodDays,
          pickupSlaMinutes: baseRow.pickupSlaMinutes,
          pickupSlaBufferMinutes: baseRow.pickupSlaBufferMinutes,
          deliverySlaCityMinutes: baseRow.deliverySlaCityMinutes,
          deliverySlaRemoteMinutes: baseRow.deliverySlaRemoteMinutes,
          disputeWindowHours: baseRow.disputeWindowHours,
          inventoryDeltaSlaMinutes: baseRow.inventoryDeltaSlaMinutes,
          returnRestockMinRemainingDays: baseRow.returnRestockMinRemainingDays,
          defaultLocale: baseRow.defaultLocale,
          updatedAt: new Date(),
        },
      })
  }

  /** Сборка Drizzle-insert-строки. Выделено из `save` для соблюдения C1 `max-lines-per-function`. */
  private buildRow(settings: TenantSettings, tenantId: TenantId): typeof tenantSettings.$inferInsert {
    return {
      tenantId: tenantId.value,
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
}
