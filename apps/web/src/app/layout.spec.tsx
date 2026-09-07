import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppLayout } from '@/app/layout'
import { LocaleProvider } from '@/shared/config/locale-provider'

describe('AppLayout (smoke)', () => {
  it('рендерится с BrandLogo и LanguageSwitcher из @dorutj/ui без падений', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <LocaleProvider>
              <AppLayout />
            </LocaleProvider>
          ),
          children: [{ index: true, element: <div data-testid="child">ok</div> }],
        },
      ],
      { initialEntries: ['/'] },
    )

    render(<RouterProvider router={router} />)

    // BrandLogo без logoUrl рендерит фолбэк-иконку с доступным именем (role="img"). Дефолтная
    // локаль LocaleProvider — 'tj', тексты ниже — таджикские переводы соответствующих ключей.
    expect(screen.getByRole('img', { name: 'Нишони DoruTJ' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Интихоби забон' })).toBeInTheDocument()
    expect(screen.getByTestId('child')).toHaveTextContent('ok')
  })
})
