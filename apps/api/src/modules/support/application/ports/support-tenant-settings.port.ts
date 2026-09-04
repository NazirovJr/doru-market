/**
 * Порт `SupportTenantSettingsPort` (EP-14, DTJ-279). Файл СВЕРХ буквального `files_owned` (та
 * же причина, что `support-unit-of-work.port.ts`) — ticket «Что сделать» п.3 прямо требует
 * «читает tenantSettings.supportFirstResponseSlaMinutes через TenantSettingsPort», а такого
 * порта нигде в кодовой базе нет (`grep -rn "TenantSettings" apps/api/src` — проверено перед
 * стартом, как прямо предписывает бриф D-EP11-8) — заводится здесь, модуль-локально.
 *
 * Значение читается из `tenant_settings.support_first_response_sla_minutes`
 * (`0038_support_ticket_sla_fields.sql`, DTJ-278) напрямую через Drizzle-адаптер этого модуля
 * (`infrastructure/adapters/drizzle-support-tenant-settings.adapter.ts`) — НЕ стаб. Решение
 * D-EP11-8 брифа `reports/EP11-EP14-CTO-BRIEF.md` (волна 5) предписывало стаб для порта
 * `OrdersFacade`, обосновывая это тем, что `orders`/`payout_schedule` физически не существовали
 * на тот момент — тот же факт-контекст для «читать tenant_settings» устарел ИНАЧЕ: колонка
 * `tenant_settings.support_first_response_sla_minutes` создана этой же волной (DTJ-278), а сама
 * таблица `tenant_settings` существует с самого начала проекта (EP-01) — прямое чтение поля не
 * требует несуществующего чужого API, только существующей таблицы. Тот же приём, что
 * `DrizzlePayoutScheduleRepository.orderBelongsToTenant` (payments, DTJ-245, принято CTO):
 * чтение ЧУЖОЙ Drizzle-схемы из своего `infrastructure` — не межмодульный deep-import (`02`
 * §1.1 запрещает импорт `domain`/`application` чужого модуля, не импорт таблицы).
 */

export const SUPPORT_TENANT_SETTINGS_PORT = Symbol.for('@dorutj/support/tenant-settings')

export interface SupportTenantSettingsPort {
  getFirstResponseSlaMinutes(tenantId: string): Promise<number>
}
