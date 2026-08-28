import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layout'
import { ComingSoonPage } from '@/app/routes/coming-soon-page'

/**
 * DTJ-003: только каркас маршрутизации. Реальные экраны каталога/поиска — другие эпики; /login
 * зарезервирован как lazy()-заглушка (react-router `lazy` route field), реальный компонент
 * подключит DTJ-028 после готовности backend-эндпоинтов OTP.
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
          const { default: Component } = await import('@/app/routes/login-placeholder-page')
          return { Component }
        },
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
