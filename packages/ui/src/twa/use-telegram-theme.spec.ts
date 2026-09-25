/**
 * `use-telegram-theme.spec.ts` (DTJ-411, тест-план «Unit», `SRS-UX-044`).
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCKED_SEMANTIC_KEYS } from '../tokens/branding-allowlist'
import { TELEGRAM_THEME_VAR_MAP, useTelegramTheme } from './use-telegram-theme'

interface MockWebApp {
  readonly themeParams: { readonly bindCssVars: ReturnType<typeof vi.fn> }
  readonly viewport: { readonly expand: ReturnType<typeof vi.fn> }
}

type WindowWithTelegram = typeof window & { Telegram?: { WebApp?: MockWebApp } }

/**
 * `bindCssVars()` реального хоста проставляет `--tg-theme-*` на `document.documentElement` —
 * мок повторяет этот побочный эффект, иначе некому подложить значения, которые хук затем читает.
 */
function installMockTelegram(tgVars: Readonly<Record<string, string>>): MockWebApp {
  const bindCssVars = vi.fn(() => {
    for (const [key, value] of Object.entries(tgVars)) {
      document.documentElement.style.setProperty(key, value)
    }
  })
  const webApp: MockWebApp = { themeParams: { bindCssVars }, viewport: { expand: vi.fn() } }
  ;(window as WindowWithTelegram).Telegram = { WebApp: webApp }
  return webApp
}

afterEach(() => {
  delete (window as WindowWithTelegram).Telegram
  for (const [brandVar] of TELEGRAM_THEME_VAR_MAP) {
    document.documentElement.style.removeProperty(brandVar)
  }
  for (const [, telegramVar] of TELEGRAM_THEME_VAR_MAP) {
    document.documentElement.style.removeProperty(telegramVar)
  }
})

describe('useTelegramTheme — вне TWA', () => {
  it('не вызывает bindCssVars/viewport.expand, когда window.Telegram отсутствует', () => {
    // Отсутствие мока — сам факт того, что ничего не брошено и не изменилось, проверяется ниже.
    const bgBefore = getComputedStyle(document.documentElement).getPropertyValue('--brand-bg')
    renderHook(() => {
      useTelegramTheme()
    })
    const bgAfter = getComputedStyle(document.documentElement).getPropertyValue('--brand-bg')
    expect(bgAfter).toBe(bgBefore)
  })
})

describe('useTelegramTheme — таблица маппинга SRS-UX-044', () => {
  const FULL_MAPPING: Readonly<Record<string, string>> = {
    '--tg-theme-bg-color': '#1c1c1e',
    '--tg-theme-secondary-bg-color': '#2c2c2e',
    '--tg-theme-text-color': '#ffffff',
    '--tg-theme-hint-color': '#8e8e93',
    '--tg-theme-button-color': '#2481cc',
    '--tg-theme-section-separator-color': '#3a3a3c',
  }

  it.each(TELEGRAM_THEME_VAR_MAP)('%s ← %s применяется при монтировании', (brandVar, telegramVar) => {
    installMockTelegram(FULL_MAPPING)
    renderHook(() => {
      useTelegramTheme()
    })
    const applied = getComputedStyle(document.documentElement).getPropertyValue(brandVar).trim()
    expect(applied).toBe(FULL_MAPPING[telegramVar])
  })

  it('вызывает bindCssVars() и viewport.expand() РОВНО один раз при монтировании в TWA', () => {
    const webApp = installMockTelegram(FULL_MAPPING)
    renderHook(() => {
      useTelegramTheme()
    })
    expect(webApp.themeParams.bindCssVars).toHaveBeenCalledTimes(1)
    expect(webApp.viewport.expand).toHaveBeenCalledTimes(1)
  })

  it('не перезаписывает --brand-border, если хост не отдал --tg-theme-section-separator-color', () => {
    const before = getComputedStyle(document.documentElement).getPropertyValue('--brand-border').trim()
    installMockTelegram({ ...FULL_MAPPING, '--tg-theme-section-separator-color': '' })
    renderHook(() => {
      useTelegramTheme()
    })
    const after = getComputedStyle(document.documentElement).getPropertyValue('--brand-border').trim()
    expect(after).toBe(before)
  })
})

describe('useTelegramTheme — семантические токены неприкосновенны (тест-нарушитель SRS-UX-012)', () => {
  it('--brand-success/-danger/-warning остаются НЕИЗМЕННЫМИ после монтирования в TWA', () => {
    const successBefore = getComputedStyle(document.documentElement).getPropertyValue('--brand-success')
    const dangerBefore = getComputedStyle(document.documentElement).getPropertyValue('--brand-danger')
    const warningBefore = getComputedStyle(document.documentElement).getPropertyValue('--brand-warning')

    installMockTelegram({
      '--tg-theme-bg-color': '#1c1c1e',
      '--tg-theme-secondary-bg-color': '#2c2c2e',
      '--tg-theme-text-color': '#ffffff',
      '--tg-theme-hint-color': '#8e8e93',
      '--tg-theme-button-color': '#2481cc',
      '--tg-theme-section-separator-color': '#3a3a3c',
    })
    renderHook(() => {
      useTelegramTheme()
    })

    expect(getComputedStyle(document.documentElement).getPropertyValue('--brand-success')).toBe(successBefore)
    expect(getComputedStyle(document.documentElement).getPropertyValue('--brand-danger')).toBe(dangerBefore)
    expect(getComputedStyle(document.documentElement).getPropertyValue('--brand-warning')).toBe(warningBefore)
  })

  it('ловушка: TELEGRAM_THEME_VAR_MAP не содержит ни одного LOCKED_SEMANTIC_KEYS токена', () => {
    const brandVarsInMap = TELEGRAM_THEME_VAR_MAP.map(([brandVar]) => brandVar)
    for (const lockedKey of LOCKED_SEMANTIC_KEYS) {
      expect(brandVarsInMap).not.toContain(`--brand-${lockedKey}`)
    }
  })
})
