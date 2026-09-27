import { createBrowserRouter, type RouteObject } from 'react-router'
import { AuthGuard } from '@/shared/auth/auth-guard'
import { AppLayout } from '@/app/layout'

/**
 * `router.tsx` (DTJ-166) — react-router 7 конфигурация кабинета аптеки.
 *
 * `/login` — единственный публичный маршрут. Всё остальное — за `AuthGuard` (layout-route без
 * собственного `path`, стандартный идиом `RequireAuth`-обёртки); неавторизованного уводит на `/login`.
 *
 * `/inventory` и `/inventory/sync-history` — заглушки `lazy()` до DTJ-167/DTJ-169.
 *
 * `index: true` — очередь заказов терминала (`OrderQueuePage`, DTJ-310), первый экран фармацевта;
 * заменяет прежний редирект на `/inventory` (тот остаётся доступен по прямой ссылке).
 *
 * Маршруты БЕЗ ведущего `/` в `path` детей — идентично `apps/web/src/app/router.tsx` (DTJ-003):
 * относительно родителя без `path` они резолвятся в абсолютные `/inventory`, `/inventory/sync-history`.
 */
const routes: RouteObject[] = [
  {
    path: 'login',
    lazy: async () => {
      const { default: Component } = await import('@/pages/login/LoginPage')
      return { Component }
    },
  },
  {
    element: <AuthGuard />,
    children: [
      // AppLayout — общий предок всех защищённых экранов, вложенные пути не меняет.
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { default: Component } = await import('@/features/order-fulfillment/order-queue/ui/OrderQueuePage')
              return { Component }
            },
          },
          // Одна строка маршрута в общем каркасе — сам экран сборки живёт в своей папке фичи.
          {
            path: 'orders/:id',
            lazy: async () => {
              const { default: Component } = await import('@/features/order-fulfillment/picking/ui/PickingPage')
              return { Component }
            },
          },
          {
            path: 'inventory',
            lazy: async () => {
              const { default: Component } = await import('@/pages/inventory/InventoryPage')
              return { Component }
            },
          },
          {
            path: 'inventory/sync-history',
            lazy: async () => {
              const { default: Component } = await import('@/pages/inventory/SyncHistoryPage')
              return { Component }
            },
          },
          // DTJ-277 (EP-11) — единственная строка, которой этот тикет касается общего каркаса
          // (files_owned DTJ-277 — только features/returns/**): очередь возвратов своей аптеки.
          {
            path: 'pharmacy/returns',
            lazy: async () => {
              const { IncomingReturnsList: Component } = await import('@/features/returns/ui/IncomingReturnsList')
              return { Component }
            },
          },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
