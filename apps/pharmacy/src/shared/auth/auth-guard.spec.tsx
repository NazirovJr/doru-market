import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useAuthStore } from '@/shared/api/auth-store'
import { AuthGuard, hasPharmacyAccess, isPharmacyRole, PHARMACY_ALLOWED_ROLES } from '@/shared/auth/auth-guard'

/**
 * DTJ-166 тест-план: «AuthGuard редиректит неавторизованного пользователя на /login» и
 * «AuthGuard пропускает авторизованного пользователя». Плюс критерий приёмки 4 (роль
 * customer/courier отклоняется) — покрыт и на уровне чистой функции, и на уровне компонента.
 */

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('isPharmacyRole / PHARMACY_ALLOWED_ROLES', () => {
  it('разрешает pharmacist, pharmacy_admin, super_admin', () => {
    expect(PHARMACY_ALLOWED_ROLES).toEqual(['pharmacist', 'pharmacy_admin', 'super_admin'])
    expect(isPharmacyRole('pharmacist')).toBe(true)
    expect(isPharmacyRole('pharmacy_admin')).toBe(true)
    expect(isPharmacyRole('super_admin')).toBe(true)
  })

  it('критерий приёмки 4: отклоняет customer и courier', () => {
    expect(isPharmacyRole('customer')).toBe(false)
    expect(isPharmacyRole('courier')).toBe(false)
  })
})

describe('hasPharmacyAccess', () => {
  it('нет ни access, ни refresh токена — доступа нет', () => {
    expect(hasPharmacyAccess({ accessToken: null, refreshToken: null, user: null })).toBe(false)
  })

  it('есть accessToken, user ещё не гидратирован (null) — доступ есть (не блокируем по этой причине)', () => {
    expect(hasPharmacyAccess({ accessToken: 'tok', refreshToken: null, user: null })).toBe(true)
  })

  it('есть сессия и подходящая роль — доступ есть', () => {
    const user = { id: 'u1', role: 'pharmacy_admin', tenantId: 't1', phoneNumber: null, fullName: null }
    expect(hasPharmacyAccess({ accessToken: 'tok', refreshToken: null, user })).toBe(true)
  })

  it('критерий приёмки 4: есть сессия, но роль customer — доступа нет', () => {
    const user = { id: 'u1', role: 'customer', tenantId: null, phoneNumber: null, fullName: null }
    expect(hasPharmacyAccess({ accessToken: 'tok', refreshToken: 'ref', user })).toBe(false)
  })

  it('только refreshToken (access ещё не восстановлен после перезагрузки) — доступ есть', () => {
    expect(hasPharmacyAccess({ accessToken: null, refreshToken: 'ref', user: null })).toBe(true)
  })
})

function renderGuardedApp(): void {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <div>login-screen</div> },
      {
        element: <AuthGuard />,
        children: [{ path: '/inventory', element: <div>inventory-screen</div> }],
      },
    ],
    { initialEntries: ['/inventory'] },
  )
  render(<RouterProvider router={router} />)
}

describe('<AuthGuard />', () => {
  it('редиректит неавторизованного пользователя на /login', () => {
    renderGuardedApp()

    expect(screen.getByText('login-screen')).toBeInTheDocument()
    expect(screen.queryByText('inventory-screen')).not.toBeInTheDocument()
  })

  it('пропускает авторизованного пользователя с подходящей ролью', () => {
    useAuthStore.setState({
      accessToken: 'tok',
      refreshToken: 'ref',
      user: { id: 'u1', role: 'pharmacist', tenantId: 't1', phoneNumber: null, fullName: null },
    })

    renderGuardedApp()

    expect(screen.getByText('inventory-screen')).toBeInTheDocument()
    expect(screen.queryByText('login-screen')).not.toBeInTheDocument()
  })

  it('критерий приёмки 4: редиректит пользователя с ролью customer, несмотря на валидную сессию', () => {
    useAuthStore.setState({
      accessToken: 'tok',
      refreshToken: 'ref',
      user: { id: 'u1', role: 'customer', tenantId: null, phoneNumber: null, fullName: null },
    })

    renderGuardedApp()

    expect(screen.getByText('login-screen')).toBeInTheDocument()
    expect(screen.queryByText('inventory-screen')).not.toBeInTheDocument()
  })
})
