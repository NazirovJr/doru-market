import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layout'
import { OnboardingQueuePage } from '@/features/onboarding-verification/onboarding-queue.page'
import { OnboardingApplicationDetailPage } from '@/features/onboarding-verification/onboarding-application-detail.page'
import { SupportTicketsQueuePage } from '@/features/support/support-tickets-queue.page'
import { SupportTicketDetailPage } from '@/features/support/support-ticket-detail.page'

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
    ],
  },
]

export const router = createBrowserRouter(routes)
