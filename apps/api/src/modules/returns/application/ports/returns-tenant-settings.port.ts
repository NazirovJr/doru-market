/**
 * Порт `ReturnsTenantSettingsPort` (EP-11, DTJ-273). Файл СВЕРХ буквального `files_owned` (та же
 * причина, что `returns-unit-of-work.port.ts` этого каталога) — ticket «Что сделать» п.2 прямо
 * требует чтения `tenantSettings.disputeWindowHours` (SRS-RET-012), п.4 читает
 * `returnRestockMinRemainingDays` (SRS-DOM-053) для приёмки. Модуль-локальный порт (`02` §1.2/
 * §1.3, тот же приём, что `support-tenant-settings.port.ts` DTJ-279) — НЕ стаб: обе колонки уже
 * существуют в `tenant_settings` (`db/schema/tenants.ts`, EP-01/02, миграция 0037/база), реальный
 * Drizzle-адаптер, не заглушка (проверено `grep -rn disputeWindowHours apps/api/src/db/schema`
 * перед стартом, правило 12 AGENTS.md).
 */
export const RETURNS_TENANT_SETTINGS_PORT = Symbol.for('@dorutj/returns/tenant-settings')

export interface ReturnsTenantSettingsPort {
  getDisputeWindowHours(tenantId: string): Promise<number>
  getReturnRestockMinRemainingDays(tenantId: string): Promise<number>
}
