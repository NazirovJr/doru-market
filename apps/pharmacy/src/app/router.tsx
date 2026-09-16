import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { AuthGuard } from '@/shared/auth/auth-guard'

/**
 * `router.tsx` (DTJ-166) — react-router 7 конфигурация кабинета аптеки.
 *
 * `/login` — единственный публичный маршрут. Всё остальное — за `AuthGuard` (layout-route без
 * собственного `path`: react-router рендерит его для ЛЮБОГО совпадения `children`, стандартный
 * идиом `RequireAuth`-обёртки). `/` редиректит на `/inventory`; для неавторизованного
 * пользователя `AuthGuard` перехватит `/inventory` и уведёт на `/login` (критерий приёмки 1).
 *
 * `/inventory` и `/inventory/sync-history` — заглушки `lazy()` (критерий «Что сделать» п.4):
 * пустые страницы-плейсхолдеры до DTJ-167/DTJ-169 (`pages/inventory/*.tsx`, DTJ-166 owns их
 * ПЕРВОЕ создание, следующие тикеты заполняют реальным экраном — см. JSDoc этих файлов).
 * `/order-queue` (упомянут в DTJ-166 «Технический контекст» как пример неймспейса) НЕ
 * регистрируется здесь — он вне scope DTJ-166 (EP-12, отдельная волна, см. DTJ-166 «Что сделать»
 * п.4: «для DTJ-167/168/169», не для EP-12).
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
      {
        index: true,
        element: <Navigate to="/inventory" replace />,
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
]

export const router = createBrowserRouter(routes)
