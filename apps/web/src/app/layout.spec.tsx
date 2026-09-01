import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppLayout } from '@/app/layout'
import { LocaleProvider } from '@/shared/config/locale-provider'

describe('AppLayout (smoke)', () => {
  it('рендерится с плейсхолдерами бренда/языка без падений', () => {
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

    expect(screen.getByTestId('brand-placeholder')).toHaveTextContent('[ Бренд ]')
    expect(screen.getByTestId('language-switcher-placeholder')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toHaveTextContent('ok')
  })
})
