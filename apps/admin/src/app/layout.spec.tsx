import { beforeEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppLayout } from './layout'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { useAuthStore, type AuthUser } from '@/shared/auth/auth-store'

function renderShell(initialPath = '/admin/tenants'): void {
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: '/admin/tenants', element: <div>tenants-screen</div> },
          { path: '/admin/my-pharmacies', element: <div>my-pharmacies-screen</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  )
  render(
    <LocaleProvider>
      <RouterProvider router={router} />
    </LocaleProvider>,
  )
}

function setUser(user: AuthUser): void {
  useAuthStore.setState({ accessToken: 'tok', refreshToken: 'ref', user })
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
  window.localStorage.clear()
})

describe('<AppLayout /> — меню по ролям (критерии приёмки 1/2 DTJ-434)', () => {
  it('super_admin видит разделы super_admin (tenants и т.д.), не видит my-pharmacies', () => {
    setUser({ id: 'u1', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: 'Boss' })
    renderShell()

    const nav = screen.getByRole('tablist')
    expect(within(nav).getByText('Тенантҳо')).toBeInTheDocument()
    expect(within(nav).queryByText('Нуқтаҳои ман')).not.toBeInTheDocument()
  })

  it('pharmacy_admin видит «Нуқтаҳои ман» первым разделом, не видит «Тенантҳо»', () => {
    setUser({ id: 'u2', role: 'pharmacy_admin', tenantId: 't1', phoneNumber: null, fullName: null })
    renderShell('/admin/my-pharmacies')

    const nav = screen.getByRole('tablist')
    expect(within(nav).getByText('Нуқтаҳои ман')).toBeInTheDocument()
    expect(within(nav).queryByText('Тенантҳо')).not.toBeInTheDocument()
  })

  it('шапка показывает имя из сессии, фолбэк — когда имени нет', () => {
    setUser({ id: 'u3', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: null })
    renderShell()

    expect(screen.getByTestId('shell-staff-label')).toHaveTextContent('Корманд')
  })

  it('выход очищает сессию', () => {
    setUser({ id: 'u1', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: null })
    renderShell()

    screen.getByTestId('shell-logout-button').click()

    expect(useAuthStore.getState().user).toBeNull()
  })
})
