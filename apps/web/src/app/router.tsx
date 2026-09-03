import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from '@/app/layout'

/**
 * DTJ-003: каркас маршрутизации. `/login` подключён DTJ-028 как
 * lazy-роут (real экран с OTP-flow).
 *
 * Корневой (`index`) маршрут — DTJ-192, `SRS-CAT-001`: заменяет заглушку
 * `app/routes/coming-soon-page.tsx` (удалена — тот файл сам документировал себя как временный
 * плейсхолдер «реальный каталог/поиск не входит в DTJ-003») на `pages/home/home-page.tsx` с
 * `SearchBar`. Lazy — тот же приём, что у остальных маршрутов ниже: код главного экрана не
 * попадает в бандл, общий для ВСЕХ маршрутов (`app/main.tsx`).
 */
const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        lazy: async () => {
          const { default: Component } = await import('@/pages/home/home-page')
          return { Component }
        },
      },
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
          const { PharmacyApplicationForm: Component } =
            await import('@/features/onboarding-application/pharmacy-application-form')
          return { Component }
        },
      },
      {
        // DTJ-199: карта аптек.
        path: 'map',
        lazy: async () => {
          const { default: Component } = await import('@/pages/map/map-page')
          return { Component }
        },
      },
      {
        // DTJ-193: экран результатов поиска (`?text=<query>`), пункт назначения `SearchBar` (DTJ-192).
        path: 'search',
        lazy: async () => {
          const { default: Component } = await import('@/pages/search-results/search-results-page')
          return { Component }
        },
      },
      {
        // DTJ-104: минимальный хост-стаб карточки товара для `AnalogsBlock` — см. JSDoc
        // `pages/medicine/medicine-page.tsx` (полноценного экрана `Medicine` пока нет отдельным тикетом).
        path: 'medicines/:id',
        lazy: async () => {
          const { default: Component } = await import('@/pages/medicine/medicine-page')
          return { Component }
        },
      },
      {
        // DTJ-234: экран корзины, сгруппированной по аптекам (REQ-UX-4).
        path: 'cart',
        lazy: async () => {
          const { default: Component } = await import('@/pages/cart/cart-page')
          return { Component }
        },
      },
      {
        // DTJ-235: экран оформления заказа — пункт назначения CTA «Перейти к оформлению» (`/cart`).
        path: 'checkout',
        lazy: async () => {
          const { default: Component } = await import('@/pages/checkout/checkout-page')
          return { Component }
        },
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
