import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapBranding } from '@/app/bootstrap-branding'

const branding = {
  data: {
    slug: 'sifat',
    brandName: 'Sifat Pharmacy',
    palette: { '--brand-primary': '#0f766e' },
    logoUrl: null,
    faviconUrl: null,
    supportPhone: null,
  },
}

const primary = (): string => getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim()

beforeEach(() => {
  document.documentElement.style.setProperty('--brand-primary', '#64748b')
  document.title = 'initial'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bootstrapBranding (web)', () => {
  it('запрашивает /tenant/branding и переопределяет нейтральную палитру без перезагрузки', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(branding), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(primary()).toBe('#64748b')

    await bootstrapBranding()

    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/tenant\/branding$/u)
    expect(primary()).toBe('#0f766e')
    expect(document.title).toBe('Sifat Pharmacy')
  })

  it('сетевой сбой: без исключения, остаются нейтральные дефолты', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(bootstrapBranding()).resolves.toBeUndefined()
    expect(primary()).toBe('#64748b')
    expect(document.title).toBe('initial')
  })

  it('ответ 500: дефолты сохраняются', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }), { status: 500 })))
    await bootstrapBranding()
    expect(primary()).toBe('#64748b')
  })
})
