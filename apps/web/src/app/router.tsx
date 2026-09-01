import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layout'
import { ComingSoonPage } from '@/app/routes/coming-soon-page'

/**
 * DTJ-003: каркас маршрутизации. `/login` подключён DTJ-028 как
 * lazy-роут (real экран с OTP-flow).
 */
const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ComingSoonPage /> },
      {
        path: 'login',
        lazy: async () => {
          const { default: Component } = await import('@/pages/login/login-page')
          return { Component }
        },
      },
      {
        path: 'pharmacy-application',
        lazy: async () => {
          const { PharmacyApplicationForm: Component } = await import(
            '@/features/onboarding-application/pharmacy-application-form'
          )
          return { Component }
        },
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
