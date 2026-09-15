/**
 * Каталог permission-строк RBAC (`docs/spec/12-api-conventions-auth-tenancy.md` §4.1,
 * формат `<resource>:<action>[:<scope>]`, SRS-API-038). Транскрипция полного списка строк
 * из матрицы прав §4.1, DTJ-005.
 *
 * Это ТОЛЬКО каталог строк, не движок RBAC: владение ролями декларируется per-эндпоинт через
 * `@Roles(...)` (грубая проверка роли, presentation), уточнение по `scope` (`own`/`pharmacy`/
 * `chain`/`any`) — в `application/policies/*.policy.ts`. Статичной матрицы «роль → права» здесь
 * нет намеренно (SRS-API-036).
 */

/** Роли RBAC (SRS-API-014, единый enum в БД как `user_role`). */
export const USER_ROLES = [
  'customer',
  'pharmacist',
  'pharmacy_admin',
  'courier',
  'support_agent',
  'super_admin',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const PERMISSIONS = {
  CATALOG_SEARCH: 'catalog:search',
  CATALOG_READ: 'catalog:read',
  ORDERS_CREATE: 'orders:create',
  ORDERS_READ_OWN: 'orders:read:own',
  ORDERS_READ_PHARMACY: 'orders:read:pharmacy',
  ORDERS_READ_ANY: 'orders:read:any',
  ORDERS_CANCEL: 'orders:cancel',
  ORDERS_START_PROCESSING: 'orders:start-processing',
  ORDERS_MARK_PICKED_UP: 'orders:mark-picked-up',
  ORDERS_MARK_DELIVERED: 'orders:mark-delivered',
  PRESCRIPTIONS_UPLOAD: 'prescriptions:upload',
  PRESCRIPTIONS_VERIFY: 'prescriptions:verify',
  PRESCRIPTIONS_READ_IMAGE: 'prescriptions:read-image',
  INVENTORY_INGEST: 'inventory:ingest',
  INVENTORY_READ: 'inventory:read',
  DISPUTES_OPEN: 'disputes:open',
  DISPUTES_RESOLVE_REJECT: 'disputes:resolve-reject',
  DISPUTES_RESOLVE_REFUND_FULL: 'disputes:resolve-refund-full',
  DISPUTES_RESOLVE_REFUND_PARTIAL: 'disputes:resolve-refund-partial',
  DISPUTES_RESOLVE_ADJUSTMENT: 'disputes:resolve-adjustment',
  RETURNS_REQUEST: 'returns:request',
  RETURNS_CONFIRM: 'returns:confirm',
  RETURNS_ADMIN_OVERRIDE: 'returns:admin-override',
  DELIVERY_REASSIGN: 'delivery:reassign',
  DELIVERY_RECORD_CASH: 'delivery:record-cash',
  PHARMACY_ACCOUNTS_APPROVE: 'pharmacy-accounts:approve',
  PHARMACY_ACCOUNTS_SUSPEND: 'pharmacy-accounts:suspend',
  PHARMACY_ACCOUNTS_UPDATE_ADDRESS: 'pharmacy-accounts:update-address',
  STAFF_ACCOUNTS_CREATE: 'staff-accounts:create',
  TENANCY_MANAGE_BRANDING: 'tenancy:manage-branding',
  TENANCY_MANAGE_COMMISSION_RATES: 'tenancy:manage-commission-rates',
  MODERATION_RESOLVE_CATALOG_MATCH: 'moderation:resolve-catalog-match',
  AUDIT_LOG_READ: 'audit-log:read',
  ONE_C_SYNC_HISTORY_READ: '1c-sync:history:read',
  // DTJ-282 (EP-14, SRS-API-038) — раздел `support:*` не входил в исходную RBAC-матрицу
  // `12-api-conventions-auth-tenancy.md` §4.1 (только `disputes:*`/`returns:*`), та же ситуация,
  // что `returns:mark-in-transit` в DTJ-275 — новые строки одной группой в конец каталога (D-27).
  SUPPORT_CREATE: 'support:create',
  SUPPORT_READ_OWN: 'support:read:own',
  SUPPORT_READ_ANY: 'support:read:any',
  SUPPORT_RESPOND: 'support:respond',
  SUPPORT_RESOLVE: 'support:resolve',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
