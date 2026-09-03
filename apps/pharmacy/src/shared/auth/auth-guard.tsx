import type { ReactElement } from 'react'
import { Navigate, Outlet } from 'react-router'
import type { UserRole } from '@dorutj/contracts'
import { useAuthStore, type AuthState } from '@/shared/api/auth-store'

/**
 * `auth-guard.tsx` (DTJ-166) — `RequireAuth`-компонент react-router 7: layout-route без `path`,
 * оборачивает защищённые маршруты (`app/router.tsx`). Редиректит на `/login`, если нет валидной
 * сессии ИЛИ роль не входит в `PHARMACY_ALLOWED_ROLES` (критерий приёмки 4 — кабинет аптеки
 * только для персонала аптеки, `customer`/`courier` отклоняются).
 *
 * Ни в общем `packages/ui`, ни где-либо ещё во фронтенде готового `RequireAuth` не найдено
 * (`apps/web` не гейтит маршруты жёстко — `/checkout` показывает inline-сообщение
 * `checkout.unauthenticated_message`, а не редиректит) — минимальная локальная реализация,
 * TODO(EP-18): вынести в общий пакет, если у `apps/courier`/будущих ролевых кабинетов появится
 * тот же паттерн (см. DTJ-166 «Риски»).
 */

/** Роли, которым разрешён вход в кабинет аптеки (DTJ-166, критерий приёмки 4). */
export const PHARMACY_ALLOWED_ROLES: readonly UserRole[] = ['pharmacist', 'pharmacy_admin', 'super_admin']

export function isPharmacyRole(role: string): boolean {
  return (PHARMACY_ALLOWED_ROLES as readonly string[]).includes(role)
}

/**
 * Чистая функция без React — переиспользуется и `AuthGuard`, и `LoginPage.tsx` (сразу после
 * успешного verify, до навигации на `/inventory`), и unit-тестами напрямую.
 */
export function hasPharmacyAccess(
  state: Pick<AuthState, 'accessToken' | 'refreshToken' | 'user'>,
): boolean {
  const hasSession = state.accessToken !== null || state.refreshToken !== null
  if (!hasSession) {
    return false
  }
  // `user` может быть ещё не гидратирован (persist восстанавливает refreshToken раньше, чем
  // придёт /auth/refresh) — не блокируем сессию по этой причине, только по ЯВНО неподходящей роли.
  return state.user === null || isPharmacyRole(state.user.role)
}

export const AuthGuard = (): ReactElement => {
  const isAuthorized = useAuthStore(hasPharmacyAccess)
  if (!isAuthorized) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
