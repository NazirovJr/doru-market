/**
 * `role-routes.ts` (DTJ-350, EP-15) — декларативная карта `role → RouteConfig[]` для раздел
 * `/admin/*`. `router.tsx` строит дерево маршрутов ИЗ этих данных, фильтруя по роли, декодированной
 * из JWT (`shared/auth/current-role.ts`) — чужие разделы физически не монтируются (критерий
 * приёмки 3 DTJ-350), не просто скрываются CSS.
 *
 * Правило пополнения (см. «Что сделать» п.6 тикета): каждый следующий тикет эпика (DTJ-351..367)
 * заменяет `component` СВОЕЙ записи ниже на реальную лениво загружаемую страницу — путь/ключ
 * названия/иконка уже зафиксированы этим тикетом и не меняются. До замены все 13 разделов
 * используют общий `SectionPlaceholderPage` (`shared/ui/section-placeholder.page.tsx`).
 *
 * DTJ-352 (EP-15) — запись `feature-flags` заменена на реальную `FeatureFlagsPage`
 * (`features/feature-flags/ui/feature-flags-page.tsx`), лениво загружаемую тем же приёмом, что
 * `SectionPlaceholder` выше. `FeatureFlagsPage` не принимает пропсы (не читает `titleKey` — сама
 * рендерит свой заголовок) — структурно совместима с `ComponentType<SectionPlaceholderPageProps>`
 * (функция с МЕНЬШИМ числом параметров присваивается типу с большим, TS позволяет это для
 * функциональных типов), обёртка не нужна.
 *
 * Иконки — временно строковый ключ (`packages/ui` пока не содержит ни одного компонента,
 * `packages/ui/src/index.ts` — пустой барабан, заглушка EP-18/DTJ-400). Рендеринг реальной
 * иконки по ключу — задача будущего меню-компонента, когда `packages/ui` их получит.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { USER_ROLES, type UserRole } from '@dorutj/contracts'
import type { SectionPlaceholderPageProps } from '@/shared/ui/section-placeholder.page'

export interface RouteConfig {
  /** Относительно `/admin/`, напр. `'tenants'` → `/admin/tenants`. */
  readonly path: string
  /** Ключ словаря `@dorutj/i18n` (`admin.nav.*`) для пункта меню/заголовка страницы. */
  readonly titleKey: string
  /** Семантический ключ иконки — см. JSDoc файла про временное отсутствие `packages/ui`. */
  readonly icon: string
  readonly Component: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>>
}

const SectionPlaceholder: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/shared/ui/section-placeholder.page').then((m) => ({ default: m.SectionPlaceholderPage })),
)

/** DTJ-352 — см. JSDoc файла про совместимость без пропсов. */
const FeatureFlagsPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/feature-flags/ui/feature-flags-page').then((m) => ({ default: m.FeatureFlagsPage })),
)

const TenantsListPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/tenants/ui/tenants-list-page').then((m) => ({ default: m.TenantsListPage })),
)

/** См. JSDoc файла про совместимость без пропсов (та же схема, что `FeatureFlagsPage`). */
const AuditLogPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/audit-log/ui/audit-log-page').then((m) => ({ default: m.AuditLogPage })),
)

/** См. JSDoc файла про совместимость без пропсов (та же схема, что `AuditLogPage`). */
const UndeliveredNotificationsPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/notifications/ui/undelivered-notifications-page').then((m) => ({ default: m.UndeliveredNotificationsPage })),
)

/** DTJ-381 (EP-17) — та же схема совместимости без пропсов, что `AuditLogPage`; путь новый, не из исходных 13 разделов DTJ-350. */
const FunnelPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/analytics/ui/funnel-page').then((m) => ({ default: m.FunnelPage })),
)

/** Та же схема совместимости без пропсов, что `FunnelPage` рядом. */
const PlatformMetricsPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/analytics/ui/platform-metrics-page').then((m) => ({ default: m.PlatformMetricsPage })),
)

/** DTJ-383 — та же схема совместимости без пропсов, что `FunnelPage` рядом. */
const TopAnalogsPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/analytics/ui/top-analogs-page').then((m) => ({ default: m.TopAnalogsPage })),
)

/** DTJ-384 — та же схема совместимости без пропсов, что `FunnelPage` рядом. */
const OnboardingFunnelPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/analytics/ui/onboarding-funnel-page').then((m) => ({ default: m.OnboardingFunnelPage })),
)

/** DTJ-354 — та же схема совместимости без пропсов, что `AuditLogPage`. */
const UsersPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/users/ui/users-page').then((m) => ({ default: m.UsersPage })),
)

/** DTJ-353 — та же схема совместимости без пропсов, что `AuditLogPage`. */
const PharmacyAccountsPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/pharmacies-crud/ui/pharmacy-accounts-page').then((m) => ({ default: m.PharmacyAccountsPage })),
)

/** Та же схема совместимости без пропсов, что `AuditLogPage` выше. */
const OwnPharmaciesPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/pharmacies-crud/ui/own-pharmacies-page').then((m) => ({ default: m.OwnPharmaciesPage })),
)

/** DTJ-364 — та же схема совместимости без пропсов, что `AuditLogPage`. */
const StaffAccountsPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/staff/ui/staff-accounts-page').then((m) => ({ default: m.StaffAccountsPage })),
)

/** DTJ-367 — та же схема совместимости без пропсов, что `AuditLogPage`. */
const PharmacySchedulePage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/schedule/ui/pharmacy-schedule-page').then((m) => ({ default: m.PharmacySchedulePage })),
)

const OrdersListPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/orders/ui/orders-list-page').then((m) => ({ default: m.OrdersListPage })),
)

const OwnOrdersPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/orders/ui/own-orders-page').then((m) => ({ default: m.OwnOrdersPage })),
)

/** DTJ-357 — та же схема совместимости без пропсов, что `AuditLogPage`; 3 записи вместо 1 placeholder `finance` (см. «Что сделать» тикета). */
const EscrowLedgerPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/finance/ui/escrow-ledger-page').then((m) => ({ default: m.EscrowLedgerPage })),
)
const PayoutSchedulePage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/finance/ui/payout-schedule-page').then((m) => ({ default: m.PayoutSchedulePage })),
)
const ReconciliationAlertsPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/finance/ui/reconciliation-alerts-page').then((m) => ({ default: m.ReconciliationAlertsPage })),
)

function section(path: string, titleKey: string, icon: string): RouteConfig {
  return { path, titleKey, icon, Component: SectionPlaceholder }
}

/** `super_admin` (тикет DTJ-350 «Что сделать» п.5): Тенанты/Фиче-флаги/Аптеки/Пользователи/Заказы/Финансы/Настройки. */
const SUPER_ADMIN_ROUTES: readonly RouteConfig[] = [
  { path: 'tenants', titleKey: 'admin.nav.tenants', icon: 'tenants', Component: TenantsListPage },
  { path: 'feature-flags', titleKey: 'admin.nav.feature_flags', icon: 'flags', Component: FeatureFlagsPage },
  { path: 'audit-log', titleKey: 'admin.nav.audit_log', icon: 'audit-log', Component: AuditLogPage },
  { path: 'undelivered-notifications', titleKey: 'admin.nav.undelivered_notifications', icon: 'notifications', Component: UndeliveredNotificationsPage },
  { path: 'analytics/funnel', titleKey: 'admin.nav.analytics_funnel', icon: 'analytics', Component: FunnelPage },
  { path: 'analytics/platform-metrics', titleKey: 'admin.nav.platform_metrics', icon: 'analytics', Component: PlatformMetricsPage },
  { path: 'analytics/top-analogs', titleKey: 'admin.nav.top_analogs', icon: 'analytics', Component: TopAnalogsPage },
  { path: 'analytics/onboarding-funnel', titleKey: 'admin.nav.onboarding_funnel', icon: 'analytics', Component: OnboardingFunnelPage },
  { path: 'pharmacies', titleKey: 'admin.nav.pharmacies', icon: 'pharmacies', Component: PharmacyAccountsPage },
  { path: 'users', titleKey: 'admin.nav.users', icon: 'users', Component: UsersPage },
  { path: 'orders', titleKey: 'admin.nav.orders', icon: 'orders', Component: OrdersListPage },
  // DTJ-357 — заменяет placeholder `finance` тремя реальными READ-ONLY экранами (эскроу-леджер/выплаты/алерты сверки).
  { path: 'finance/escrow-ledger', titleKey: 'admin.nav.finance_escrow_ledger', icon: 'finance', Component: EscrowLedgerPage },
  { path: 'finance/payout-schedule', titleKey: 'admin.nav.finance_payout_schedule', icon: 'finance', Component: PayoutSchedulePage },
  { path: 'finance/reconciliation-alerts', titleKey: 'admin.nav.finance_reconciliation_alerts', icon: 'finance', Component: ReconciliationAlertsPage },
  section('settings', 'admin.nav.settings', 'settings'),
]

/** `pharmacy_admin`: Мои точки/Заказы/Сотрудники/Ключи 1С/Отчёты/Расписание. */
const PHARMACY_ADMIN_ROUTES: readonly RouteConfig[] = [
  { path: 'my-pharmacies', titleKey: 'admin.nav.my_pharmacies', icon: 'pharmacies', Component: OwnPharmaciesPage },
  { path: 'my-orders', titleKey: 'admin.nav.my_orders', icon: 'orders', Component: OwnOrdersPage },
  { path: 'staff', titleKey: 'admin.nav.staff', icon: 'staff', Component: StaffAccountsPage },
  section('integration-keys', 'admin.nav.integration_keys', 'keys'),
  section('reports', 'admin.nav.reports', 'reports'),
  { path: 'schedule', titleKey: 'admin.nav.schedule', icon: 'schedule', Component: PharmacySchedulePage },
]

const EMPTY_ROUTES: readonly RouteConfig[] = []

/** `Record<UserRole, ...>` — компилятор гарантирует запись для ВСЕХ 6 ролей (см. тест-план тикета). */
const ROLE_ROUTES: Readonly<Record<UserRole, readonly RouteConfig[]>> = {
  super_admin: SUPER_ADMIN_ROUTES,
  pharmacy_admin: PHARMACY_ADMIN_ROUTES,
  customer: EMPTY_ROUTES,
  pharmacist: EMPTY_ROUTES,
  courier: EMPTY_ROUTES,
  support_agent: EMPTY_ROUTES,
}

/** Given декодированная роль (или `null` — нет сессии), возвращает список маршрутов `/admin/*` этой роли. */
export function getRoutesForRole(role: UserRole | null): readonly RouteConfig[] {
  if (role === null || !(USER_ROLES as readonly string[]).includes(role)) {
    return EMPTY_ROUTES
  }
  // `Record<UserRole, V>` — НЕ индекс-сигнатура (`{ [key: string]: V }`), а явные свойства на
  // каждый литерал объединения — `noUncheckedIndexedAccess` не добавляет `| undefined` для такого
  // доступа, когда `role` уже сужен до `UserRole` (проверено выше). Фолбэк `?? EMPTY_ROUTES` был
  // бы недостижимым кодом (`@typescript-eslint/no-unnecessary-condition` ловит именно это).
  return ROLE_ROUTES[role]
}
