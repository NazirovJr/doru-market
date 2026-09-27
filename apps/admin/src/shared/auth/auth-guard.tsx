import type { ReactElement } from 'react'
import { Navigate, Outlet } from 'react-router'
import type { UserRole } from '@dorutj/contracts'
import { useAuthStore, type AuthState } from './auth-store'

// Роли с доступом к apps/admin (тикет DTJ-434, «Что сделать» п.1) — customer/pharmacist/courier
// технически проходят OTP-verify (эндпоинт роле-агностичен), но отклоняются здесь.
export const ADMIN_ALLOWED_ROLES: readonly UserRole[] = ['super_admin', 'pharmacy_admin', 'support_agent']

export function isAdminRole(role: string): boolean {
  return (ADMIN_ALLOWED_ROLES as readonly string[]).includes(role)
}

export function hasAdminAccess(state: Pick<AuthState, 'accessToken' | 'refreshToken' | 'user'>): boolean {
  const hasSession = state.accessToken !== null || state.refreshToken !== null
  if (!hasSession) {
    return false
  }
  return state.user === null || isAdminRole(state.user.role)
}

export const AuthGuard = (): ReactElement => {
  const isAuthorized = useAuthStore(hasAdminAccess)
  if (!isAuthorized) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
