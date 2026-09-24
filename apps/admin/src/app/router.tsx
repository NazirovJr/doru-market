import { lazy, Suspense } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layout'
import { OnboardingQueuePage } from '@/features/onboarding-verification/onboarding-queue.page'
import { OnboardingApplicationDetailPage } from '@/features/onboarding-verification/onboarding-application-detail.page'
import { SupportTicketsQueuePage } from '@/features/support/support-tickets-queue.page'
import { SupportTicketDetailPage } from '@/features/support/support-ticket-detail.page'
import { getRoutesForRole, type RouteConfig } from '@/app/role-routes'
import { getCurrentRole } from '@/shared/auth/current-role'
import { ForbiddenPage } from '@/shared/ui/forbidden.page'

// Путь с параметром :tenantId не ложится в декларативную карту role-routes.ts — отдельная ветка ниже.
const TenantSettingsForm = lazy(() =>
  import('@/features/tenants/ui/tenant-settings-form').then((m) => ({ default: m.TenantSettingsForm })),
)

/**
 * DTJ-075: scaffolding `apps/admin`. Точка расширения для EP-14/EP-15/EP-17 —
 * добавляют свои секции как гостевые правки `children` (см. `00-EPICS.md`
 * «Пересекающееся владение» п.1).
 *
 * DTJ-350 (EP-15): ветка `/admin/*` ниже — единственная НОВАЯ правка этого тикета. Роль
 * читается ОДИН раз при построении роутера (`getCurrentRole()`, декодирует JWT БЕЗ проверки
 * подписи — реальная авторизация остаётся на бэкенде, см. JSDoc `shared/auth/current-role.ts`).
 * Маршруты чужой роли физически отсутствуют в дереве (критерий приёмки 3 DTJ-350) — прямой
 * переход по URL падает на `admin/*` catch-all → `ForbiddenPage`, не на пустой экран.
 */
function buildRoleRoute(config: RouteConfig): RouteObject {
  const { Component } = config
  return {
    path: `admin/${config.path}`,
    element: (
      <Suspense fallback={null}>
        <Component titleKey={config.titleKey} />
      </Suspense>
    ),
  }
}

const currentRole = getCurrentRole()
const roleRoutes: RouteObject[] = getRoutesForRole(currentRole).map(buildRoleRoute)

const tenantDetailRoutes: RouteObject[] =
  currentRole === 'super_admin'
    ? [
        {
          path: 'admin/tenants/:tenantId',
          element: (
            <Suspense fallback={null}>
              <TenantSettingsForm />
            </Suspense>
          ),
        },
      ]
    : []

const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        path: 'admin/onboarding-queue',
        element: <OnboardingQueuePage />,
      },
      {
        path: 'admin/onboarding-queue/:subjectType/:id',
        element: <OnboardingApplicationDetailPage />,
      },
      // DTJ-283 (EP-14) — гостевая правка `children` по правилу «Пересекающееся владение» п.1,
      // см. JSDoc файла выше.
      {
        path: 'admin/support-tickets',
        element: <SupportTicketsQueuePage />,
      },
      {
        path: 'admin/support-tickets/:id',
        element: <SupportTicketDetailPage />,
      },
      ...roleRoutes,
      ...tenantDetailRoutes,
      {
        // Catch-all — ЛЮБОЙ `/admin/*`, не совпавший ни с одним маршрутом выше (чужая роль,
        // опечатка в пути). Порядок важен: react-router ранжирует по специфичности статических
        // сегментов независимо от порядка объявления, но splat остаётся наименее специфичным —
        // ставим последним для читаемости, не для корректности.
        path: 'admin/*',
        element: <ForbiddenPage />,
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
