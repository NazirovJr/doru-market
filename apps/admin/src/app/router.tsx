import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layout'
import { OnboardingQueuePage } from '@/features/onboarding-verification/onboarding-queue.page'
import { OnboardingApplicationDetailPage } from '@/features/onboarding-verification/onboarding-application-detail.page'

/**
 * DTJ-075: scaffolding `apps/admin`. Точка расширения для EP-14/EP-15/EP-17 —
 * добавляют свои секции как гостевые правки `children` (см. `00-EPICS.md`
 * «Пересекающееся владение» п.1).
 */
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
    ],
  },
]

export const router = createBrowserRouter(routes)
