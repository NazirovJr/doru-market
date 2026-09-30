import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TenantBrandLogo } from './tenant-brand-logo'
import { applyTenantBranding } from './tenant-branding'

afterEach(() => {
  cleanup()
})

describe('TenantBrandLogo', () => {
  it('до загрузки бренда показывает fallback-имя без <img>', () => {
    render(<TenantBrandLogo fallbackName="Fallback" />)
    expect(screen.getByRole('img', { name: 'Fallback' })).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('после применения бренда берёт имя и логотип тенанта', () => {
    render(<TenantBrandLogo fallbackName="Fallback" size={32} />)
    act(() => {
      applyTenantBranding({ brandName: 'Sifat', palette: {}, logoUrl: 'https://cdn.example.com/logo.png', faviconUrl: null })
    })
    const img = screen.getByRole('img', { name: 'Sifat' })
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/logo.png')
    expect(img).toHaveAttribute('width', '32')
  })
})
