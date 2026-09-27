import { lazy, useMemo, Suspense, type ReactElement } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router'
import type { UserRole } from '@dorutj/contracts'
import { AppLayout } from '@/app/layout'
import { OnboardingQueuePage } from '@/features/onboarding-verification/onboarding-queue.page'
import { OnboardingApplicationDetailPage } from '@/features/onboarding-verification/onboarding-application-detail.page'
import { SupportTicketsQueuePage } from '@/features/support/support-tickets-queue.page'
import { SupportTicketDetailPage } from '@/features/support/support-ticket-detail.page'
import { OrderDetailPage } from '@/features/orders/ui/order-detail-page'
import { getRoutesForRole, type RouteConfig } from '@/app/role-routes'
import { AuthGuard } from '@/shared/auth/auth-guard'
import { useAuthStore } from '@/shared/auth/auth-store'
import { ForbiddenPage } from '@/shared/ui/forbidden.page'

const TenantSettingsForm = lazy(() =>
  import('@/features/tenants/ui/tenant-settings-form').then((m) => ({ default: m.TenantSettingsForm })),
)

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

// support_agent пока не имеет собственных разделов в role-routes.ts (см. её ROLE_ROUTES) —
// временный дефолт на уже существующий общий раздел очереди обращений.
const FALLBACK_INDEX_PATH = '/admin/support-tickets'

function firstRoutePath(role: UserRole | null): string {
  const first = getRoutesForRole(role)[0]
  return first !== undefined ? `/admin/${first.path}` : FALLBACK_INDEX_PATH
}

// Роль читает реактивно в момент рендера (не из замыкания buildRoutes) — старый router может
// домонтировать этот индекс раньше, чем AppRouter пересоберёт дерево под новую роль.
const IndexRedirect = (): ReactElement => {
  const role = useAuthStore((state) => (state.user?.role ?? null) as UserRole | null)
  return <Navigate to={firstRoutePath(role)} replace />
}

function buildRoutes(role: UserRole | null): RouteObject[] {
  const roleRoutes = getRoutesForRole(role).map(buildRoleRoute)
  const tenantDetailRoutes: RouteObject[] =
    role === 'super_admin'
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

  return [
    {
      path: 'login',
      lazy: async () => {
        const { default: Component } = await import('@/features/auth/ui/login-page')
        return { Component }
      },
    },
    {
      element: <AuthGuard />,
      children: [
        {
          element: <AppLayout />,
          children: [
            { index: true, element: <IndexRedirect /> },
            { path: 'admin/onboarding-queue', element: <OnboardingQueuePage /> },
            { path: 'admin/onboarding-queue/:subjectType/:id', element: <OnboardingApplicationDetailPage /> },
            { path: 'admin/support-tickets', element: <SupportTicketsQueuePage /> },
            { path: 'admin/support-tickets/:id', element: <SupportTicketDetailPage /> },
            { path: 'admin/orders/:id', element: <OrderDetailPage /> },
            ...roleRoutes,
            ...tenantDetailRoutes,
            { path: 'admin/*', element: <ForbiddenPage /> },
          ],
        },
      ],
    },
  ]
}

export const AppRouter = (): ReactElement => {
  const role = useAuthStore((state) => (state.user?.role ?? null) as UserRole | null)
  const router = useMemo(() => createBrowserRouter(buildRoutes(role)), [role])
  return <RouterProvider router={router} />
}
