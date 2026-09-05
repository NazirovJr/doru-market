/**
 * `DrizzleSupportTenantSettingsAdapter` (EP-14, DTJ-279) — реализация
 * `SupportTenantSettingsPort` через прямое чтение `tenant_settings.
 * support_first_response_sla_minutes` (`0038_support_ticket_sla_fields.sql`, DTJ-278). НЕ
 * стаб — см. JSDoc порта для обоснования (устаревший контекст брифа D-EP11-8, таблица/колонка
 * физически существуют на этой волне).
 *
 * `DEFAULT_SLA_MINUTES` — тот же fallback, что DB-дефолт колонки (60): используется ТОЛЬКО если
 * строка `tenant_settings` почему-то отсутствует (не должно происходить в норме — `tenants`/
 * `tenant_settings` создаются атомарно, EP-02) — безопасный дефолт чтения данных (D-EP11-8: не
 * чтение-разрешение, где безопасного значения не бывает).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { tenantSettings } from '@/db/schema/tenants.js'
import {
  SUPPORT_TENANT_SETTINGS_PORT,
  type SupportTenantSettingsPort,
} from '@/modules/support/application/ports/support-tenant-settings.port.js'

const DEFAULT_SLA_MINUTES = 60

@Injectable()
export class DrizzleSupportTenantSettingsAdapter implements SupportTenantSettingsPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async getFirstResponseSlaMinutes(tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({ minutes: tenantSettings.supportFirstResponseSlaMinutes })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1)
    return row?.minutes ?? DEFAULT_SLA_MINUTES
  }
}

export const SUPPORT_TENANT_SETTINGS_DRIZZLE_PROVIDER = {
  provide: SUPPORT_TENANT_SETTINGS_PORT,
  useClass: DrizzleSupportTenantSettingsAdapter,
} as const
