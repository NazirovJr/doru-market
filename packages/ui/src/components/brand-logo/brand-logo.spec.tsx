import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { BrandLogo } from './brand-logo.js'

describe('BrandLogo — фолбэк (AC3)', () => {
  it('logoUrl===undefined → рендерит встроенный SVG-фолбэк, а не <img> с пустым src', () => {
    render(<BrandLogo logoUrl={undefined} alt="Логотип DoruTJ" />)

    expect(screen.getByRole('img', { name: 'Логотип DoruTJ' })).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('logoUrl — пустая строка → тоже фолбэк (не <img src="">)', () => {
    render(<BrandLogo logoUrl="" alt="Логотип DoruTJ" />)
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('logoUrl задан → рендерит <img> с этим src', () => {
    render(<BrandLogo logoUrl="https://cdn.example.com/logo.png" alt="Логотип DoruTJ" />)
    const image = screen.getByRole('img', { name: 'Логотип DoruTJ' })
    expect(image.tagName).toBe('IMG')
    expect(image).toHaveAttribute('src', 'https://cdn.example.com/logo.png')
  })

  it('ошибка загрузки <img> (onError) → переключается на фолбэк', () => {
    render(<BrandLogo logoUrl="https://cdn.example.com/broken.png" alt="Логотип DoruTJ" />)
    const image = screen.getByRole('img', { name: 'Логотип DoruTJ' })

    fireEvent.error(image)

    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('svg')).not.toBeNull()
  })
})

describe('BrandLogo — alt-текст без хардкода бренда (SRS-UX-010)', () => {
  it('alt равен ровно переданному пропу, независимо от локали/бренда потребителя', () => {
    render(<BrandLogo logoUrl={undefined} alt="Аптека «Салют»" />)
    expect(screen.getByLabelText('Аптека «Салют»')).toBeInTheDocument()
  })

  it('рендер с брендом, не совпадающим с DoruTJ, не содержит строки "DoruTJ" нигде в DOM — компонент не подставляет своё значение поверх пропа', () => {
    render(<BrandLogo logoUrl={undefined} alt="Аптека «Салют»" />)
    expect(document.body.textContent).not.toContain('DoruTJ')
    expect(document.body.innerHTML).not.toContain('DoruTJ')
  })
})

describe('BrandLogo — доступность', () => {
  it('ноль critical/serious a11y-нарушений (фолбэк и <img>)', async () => {
    const fallback = await renderWithA11yCheck(<BrandLogo logoUrl={undefined} alt="Логотип DoruTJ" />)
    expect(fallback.axeResults).toHaveNoViolations()

    const withImage = await renderWithA11yCheck(<BrandLogo logoUrl="https://cdn.example.com/logo.png" alt="Логотип DoruTJ" />)
    expect(withImage.axeResults).toHaveNoViolations()
  })
})
