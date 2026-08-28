import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { LocaleProvider, useLocale } from '@/app/providers/locale-provider'

const LOCALE_STORAGE_KEY = 'dorutj.locale'

const LocaleProbe = (): ReactElement => {
  const { locale, setLocale } = useLocale()
  return (
    <div>
      <span data-testid="current-locale">{locale}</span>
      <button
        type="button"
        onClick={() => {
          setLocale('ru')
        }}
      >
        ru
      </button>
    </div>
  )
}

function renderProbe(): void {
  render(
    <LocaleProvider>
      <LocaleProbe />
    </LocaleProvider>,
  )
}

afterEach(() => {
  window.localStorage.clear()
})

describe('LocaleProvider', () => {
  it('дефолт — tj, когда в localStorage ничего не сохранено', () => {
    renderProbe()
    expect(screen.getByTestId('current-locale')).toHaveTextContent('tj')
  })

  it('читает ранее сохранённую локаль из localStorage', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    renderProbe()
    expect(screen.getByTestId('current-locale')).toHaveTextContent('en')
  })

  it('сохраняет выбор языка в localStorage при смене', async () => {
    renderProbe()
    screen.getByText('ru').click()
    await waitFor(() => {
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ru')
    })
    expect(screen.getByTestId('current-locale')).toHaveTextContent('ru')
  })

  it('useLocale вне LocaleProvider бросает понятную ошибку', () => {
    expect(() => render(<LocaleProbe />)).toThrow('useLocale должен использоваться внутри LocaleProvider')
  })
})
