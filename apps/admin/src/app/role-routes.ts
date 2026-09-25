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

/** DTJ-354 — та же схема совместимости без пропсов, что `AuditLogPage`. */
const UsersPage: LazyExoticComponent<ComponentType<SectionPlaceholderPageProps>> = lazy(() =>
  import('@/features/users/ui/users-page').then((m) => ({ default: m.UsersPage })),
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
  section('pharmacies', 'admin.nav.pharmacies', 'pharmacies'),
  { path: 'users', titleKey: 'admin.nav.users', icon: 'users', Component: UsersPage },
  section('orders', 'admin.nav.orders', 'orders'),
  section('finance', 'admin.nav.finance', 'finance'),
  section('settings', 'admin.nav.settings', 'settings'),
]

/** `pharmacy_admin`: Мои точки/Заказы/Сотрудники/Ключи 1С/Отчёты/Расписание. */
const PHARMACY_ADMIN_ROUTES: readonly RouteConfig[] = [
  section('my-pharmacies', 'admin.nav.my_pharmacies', 'pharmacies'),
  section('my-orders', 'admin.nav.my_orders', 'orders'),
  section('staff', 'admin.nav.staff', 'staff'),
  section('integration-keys', 'admin.nav.integration_keys', 'keys'),
  section('reports', 'admin.nav.reports', 'reports'),
  section('schedule', 'admin.nav.schedule', 'schedule'),
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
