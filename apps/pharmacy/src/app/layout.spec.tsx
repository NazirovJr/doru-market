import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { AppLayout } from '@/app/layout'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { useAuthStore, type AuthUser } from '@/shared/api/auth-store'

/**
 * DTJ-433 тест-план: переключение языка сохраняется между разделами (критерий приёмки 1,
 * персистентность — отдельно в `locale-provider.spec.tsx`) и навигация скрывает разделы,
 * недоступные роли (критерий приёмки 2).
 */

function renderShell(initialPath = '/'): void {
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <div>order-queue-screen</div> },
          { path: '/inventory', element: <div>inventory-screen</div> },
          { path: '/inventory/sync-history', element: <div>sync-history-screen</div> },
          { path: '/pharmacy/returns', element: <div>returns-screen</div> },
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

describe('<AppLayout /> — навигация по ролям (критерий приёмки 2)', () => {
  it('pharmacist видит все 4 раздела кабинета (локаль по умолчанию — tj)', () => {
    setUser({ id: 'u1', role: 'pharmacist', tenantId: 't1', phoneNumber: null, fullName: 'Фарзона' })
    renderShell()

    const nav = screen.getByRole('tablist')
    expect(within(nav).getByText('Навбати фармоишҳо')).toBeInTheDocument()
    expect(within(nav).getByText('Захира')).toBeInTheDocument()
    expect(within(nav).getByText('Таърихи синхронизатсия')).toBeInTheDocument()
    expect(within(nav).getByText('Баргардонидан')).toBeInTheDocument()
  })

  it('super_admin не видит «Очередь заказов»/«Остатки» — эти эндпоинты его роль не пускает', () => {
    setUser({ id: 'u2', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: null })
    renderShell()

    const nav = screen.getByRole('tablist')
    expect(within(nav).queryByText('Навбати фармоишҳо')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Захира')).not.toBeInTheDocument()
    expect(within(nav).getByText('Таърихи синхронизатсия')).toBeInTheDocument()
    expect(within(nav).getByText('Баргардонидан')).toBeInTheDocument()
  })

  it('шапка показывает имя сотрудника из сессии, фолбэк — когда имени нет', () => {
    setUser({ id: 'u3', role: 'pharmacist', tenantId: 't1', phoneNumber: null, fullName: null })
    renderShell()
    expect(screen.getByTestId('shell-staff-label')).toHaveTextContent('Ходими дорухона')
  })
})

describe('<AppLayout /> — переключатель языка (критерий приёмки 1)', () => {
  it('смена языка в шапке немедленно переводит навигацию на RU', () => {
    setUser({ id: 'u1', role: 'pharmacist', tenantId: 't1', phoneNumber: null, fullName: null })
    renderShell()

    fireEvent.click(screen.getByText('RU'))
    expect(screen.getByText('История синхронизации')).toBeInTheDocument()
    expect(screen.getByText('Возвраты')).toBeInTheDocument()
  })
})
