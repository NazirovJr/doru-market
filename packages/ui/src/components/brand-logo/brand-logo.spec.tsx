/**
 * `brand-logo.spec.tsx` (DTJ-408, критерий приёмки 3, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { BrandLogo } from './brand-logo'

afterEach(() => {
  cleanup()
})

describe('BrandLogo — фоллбэк при отсутствующем logoUrl (AC3)', () => {
  it('рендерит встроенный SVG-фоллбэк, а не <img> с пустым src, когда logoUrl не передан', () => {
    render(<BrandLogo altText="DoruTJ" />)
    expect(screen.queryByRole('img', { name: 'DoruTJ' })).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('рендерит фоллбэк и для пустой строки logoUrl', () => {
    render(<BrandLogo logoUrl="" altText="DoruTJ" />)
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('svg')).not.toBeNull()
  })
})

describe('BrandLogo — рендер <img>, фоллбэк на onError', () => {
  it('рендерит <img> с переданным alt, когда logoUrl задан', () => {
    render(<BrandLogo logoUrl="https://cdn.example.tj/logo.png" altText="Аптека Плюс" />)
    const img = screen.getByRole('img', { name: 'Аптека Плюс' })
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('src', 'https://cdn.example.tj/logo.png')
  })

  it('переключается на SVG-фоллбэк при onError (сломанная ссылка)', () => {
    render(<BrandLogo logoUrl="https://cdn.example.tj/broken.png" altText="Аптека Плюс" />)
    fireEvent.error(screen.getByRole('img', { name: 'Аптека Плюс' }))
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('svg')).not.toBeNull()
  })
})

describe('BrandLogo — alt-текст не буквальный бренд (SRS-UX-010)', () => {
  it('alt-текст берётся из переданного пропа altText, компонент не подставляет свой литерал', () => {
    render(<BrandLogo altText="Аптека Плюс" />)
    expect(screen.getByRole('img', { name: 'Аптека Плюс' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'DoruTJ' })).not.toBeInTheDocument()
  })
})

describe('BrandLogo — доступность', () => {
  it('нулевые critical/serious нарушения (фоллбэк)', async () => {
    const { axeResults } = await renderWithA11yCheck(<BrandLogo altText="DoruTJ" />)
    assertNoBlockingViolations(axeResults)
  })

  it('нулевые critical/serious нарушения (img)', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <BrandLogo logoUrl="https://cdn.example.tj/logo.png" altText="DoruTJ" />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
