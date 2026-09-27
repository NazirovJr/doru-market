import { beforeEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useAuthStore } from './auth-store'
import { ADMIN_ALLOWED_ROLES, AuthGuard, hasAdminAccess, isAdminRole } from './auth-guard'

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('isAdminRole / ADMIN_ALLOWED_ROLES', () => {
  it('разрешает super_admin, pharmacy_admin, support_agent (DTJ-434 «Что сделать» п.1)', () => {
    expect(ADMIN_ALLOWED_ROLES).toEqual(['super_admin', 'pharmacy_admin', 'support_agent'])
    expect(isAdminRole('super_admin')).toBe(true)
    expect(isAdminRole('pharmacy_admin')).toBe(true)
    expect(isAdminRole('support_agent')).toBe(true)
  })

  it('отклоняет customer/pharmacist/courier', () => {
    expect(isAdminRole('customer')).toBe(false)
    expect(isAdminRole('pharmacist')).toBe(false)
    expect(isAdminRole('courier')).toBe(false)
  })
})

describe('hasAdminAccess', () => {
  it('нет ни access, ни refresh токена — доступа нет', () => {
    expect(hasAdminAccess({ accessToken: null, refreshToken: null, user: null })).toBe(false)
  })

  it('есть сессия и подходящая роль — доступ есть', () => {
    const user = { id: 'u1', role: 'pharmacy_admin', tenantId: 't1', phoneNumber: null, fullName: null }
    expect(hasAdminAccess({ accessToken: 'tok', refreshToken: null, user })).toBe(true)
  })

  it('критерий приёмки 4: есть сессия, но роль pharmacist — доступа нет', () => {
    const user = { id: 'u1', role: 'pharmacist', tenantId: null, phoneNumber: null, fullName: null }
    expect(hasAdminAccess({ accessToken: 'tok', refreshToken: 'ref', user })).toBe(false)
  })
})

function renderGuardedApp(): void {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <div>login-screen</div> },
      { element: <AuthGuard />, children: [{ path: '/admin/tenants', element: <div>tenants-screen</div> }] },
    ],
    { initialEntries: ['/admin/tenants'] },
  )
  render(<RouterProvider router={router} />)
}

describe('<AuthGuard />', () => {
  it('редиректит неавторизованного пользователя на /login', () => {
    renderGuardedApp()

    expect(screen.getByText('login-screen')).toBeInTheDocument()
    expect(screen.queryByText('tenants-screen')).not.toBeInTheDocument()
  })

  it('пропускает авторизованного пользователя с подходящей ролью', () => {
    useAuthStore.setState({
      accessToken: 'tok',
      refreshToken: 'ref',
      user: { id: 'u1', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: null },
    })

    renderGuardedApp()

    expect(screen.getByText('tenants-screen')).toBeInTheDocument()
    expect(screen.queryByText('login-screen')).not.toBeInTheDocument()
  })

  it('критерий приёмки 4: редиректит пользователя с ролью pharmacist, несмотря на валидную сессию', () => {
    useAuthStore.setState({
      accessToken: 'tok',
      refreshToken: 'ref',
      user: { id: 'u1', role: 'pharmacist', tenantId: null, phoneNumber: null, fullName: null },
    })

    renderGuardedApp()

    expect(screen.getByText('login-screen')).toBeInTheDocument()
    expect(screen.queryByText('tenants-screen')).not.toBeInTheDocument()
  })
})
