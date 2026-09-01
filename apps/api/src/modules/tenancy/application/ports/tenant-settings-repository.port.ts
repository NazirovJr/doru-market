/**
 * `TenantSettingsRepositoryPort` (DTJ-052) — отдельный порт для value entity
 * `tenant_settings`. Согласно `02` §1.3 — порты объявляются в `application`,
 * реализация — в `infrastructure`, связывание — в `<context>.module.ts`.
 */
import type { TenantId } from '../../domain/value-objects/tenant-id.vo.js'
import type { TenantSettings } from '../../domain/tenant-settings.entity.js'

export const TENANT_SETTINGS_REPOSITORY = Symbol.for('@dorutj/tenancy/tenant-settings-repository')

export interface TenantSettingsRepositoryPort {
  findByTenantId(tenantId: TenantId): Promise<TenantSettings | null>
  save(settings: TenantSettings, tenantId: TenantId): Promise<void>
}
