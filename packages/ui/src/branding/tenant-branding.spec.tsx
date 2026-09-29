import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTenantBranding, bootstrapBranding, parseTenantBranding, useTenantBranding } from './tenant-branding'

const valid = {
  slug: 'sifat',
  brandName: 'Sifat Pharmacy',
  palette: { '--brand-primary': '#0f766e', '--brand-radius': '12px', '--brand-font-family': "'Inter', system-ui, sans-serif" },
  logoUrl: 'https://cdn.example.com/logo.png',
  faviconUrl: 'https://cdn.example.com/favicon.ico',
  supportPhone: null,
}

const primary = (): string => document.documentElement.style.getPropertyValue('--brand-primary')

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  document.head.querySelectorAll('link[rel="icon"]').forEach((node) => {
    node.remove()
  })
  document.title = 'initial'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('parseTenantBranding', () => {
  it('нормализует валидный ответ', () => {
    expect(parseTenantBranding(valid)).toEqual({
      brandName: 'Sifat Pharmacy',
      palette: valid.palette,
      logoUrl: valid.logoUrl,
      faviconUrl: valid.faviconUrl,
    })
  })

  it.each([null, 'x', {}, { brandName: '', palette: {} }, { brandName: 'X', palette: 'red' }])('невалидная форма %j → null', (raw) => {
    expect(parseTenantBranding(raw)).toBeNull()
  })

  it('отбрасывает чужие ключи и инъекционные значения, оставляя валидные токены', () => {
    const parsed = parseTenantBranding({
      brandName: 'X',
      palette: {
        '--brand-primary': '#0f766e',
        '--brand-accent': 'url(javascript:alert(1))',
        '--brand-bg': '#fff;background:red',
        background: '#000000',
        '--evil_key': '#000000',
        '--brand-radius': 12,
      },
    })
    expect(parsed?.palette).toEqual({ '--brand-primary': '#0f766e' })
  })

  it('не-http(s) logoUrl/faviconUrl отбрасываются', () => {
    const parsed = parseTenantBranding({ brandName: 'X', palette: {}, logoUrl: 'javascript:alert(1)', faviconUrl: 'data:image/png;base64,AA' })
    expect(parsed).toMatchObject({ logoUrl: null, faviconUrl: null })
  })
})

describe('bootstrapBranding', () => {
  it('до ответа — дефолты, после — палитра, title и favicon без перезагрузки', async () => {
    let resolveLoad: (value: unknown) => void = () => undefined
    const pending = bootstrapBranding(() => new Promise((resolve) => { resolveLoad = resolve }))
    expect(primary()).toBe('')
    expect(document.title).toBe('initial')

    await Promise.resolve()
    resolveLoad(valid)
    await pending

    expect(primary()).toBe('#0f766e')
    expect(document.documentElement.style.getPropertyValue('--brand-radius')).toBe('12px')
    expect(document.title).toBe('Sifat Pharmacy')
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toBe(valid.faviconUrl)
  })

  it('обновляет существующий <link rel="icon">, а не плодит новые', async () => {
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon', href: 'https://old.example.com/i.ico' }))
    await bootstrapBranding(() => Promise.resolve(valid))
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
    expect(links).toHaveLength(1)
    expect(links[0]?.href).toBe(valid.faviconUrl)
  })

  it('сетевая ошибка и синхронное исключение загрузчика не пробрасываются, дефолты сохраняются', async () => {
    await expect(bootstrapBranding(() => Promise.reject(new Error('network')))).resolves.toBeUndefined()
    await expect(
      bootstrapBranding(() => {
        throw new Error('sync')
      }),
    ).resolves.toBeUndefined()
    expect(primary()).toBe('')
    expect(document.title).toBe('initial')
  })

  it('невалидный ответ не меняет страницу', async () => {
    await bootstrapBranding(() => Promise.resolve({ oops: true }))
    expect(primary()).toBe('')
  })

  it('медленный ответ не блокирует старт по таймауту, но применяется позже', async () => {
    vi.useFakeTimers()
    let resolveLoad: (value: unknown) => void = () => undefined
    const started = bootstrapBranding(() => new Promise((resolve) => { resolveLoad = resolve }), { timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    await started
    expect(primary()).toBe('')

    resolveLoad(valid)
    await vi.advanceTimersByTimeAsync(0)
    expect(primary()).toBe('#0f766e')
  })
})

describe('useTenantBranding', () => {
  const Probe = () => <span data-testid="name">{useTenantBranding()?.brandName ?? 'fallback'}</span>

  it('перерисовывает потребителя после применения бренда', () => {
    render(<Probe />)
    act(() => {
      applyTenantBranding({ brandName: 'Renamed', palette: {}, logoUrl: null, faviconUrl: null })
    })
    expect(screen.getByTestId('name').textContent).toBe('Renamed')
  })
})
