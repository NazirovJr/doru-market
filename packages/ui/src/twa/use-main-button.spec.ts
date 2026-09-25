/**
 * `use-main-button.spec.ts` (DTJ-411, тест-план «Unit», `SRS-UX-045/046`).
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMainButton } from './use-main-button'

interface MockMainButton {
  readonly setText: ReturnType<typeof vi.fn>
  readonly show: ReturnType<typeof vi.fn>
  readonly hide: ReturnType<typeof vi.fn>
  readonly enable: ReturnType<typeof vi.fn>
  readonly disable: ReturnType<typeof vi.fn>
  readonly showProgress: ReturnType<typeof vi.fn>
  readonly hideProgress: ReturnType<typeof vi.fn>
  readonly onClick: ReturnType<typeof vi.fn>
  readonly offClick: ReturnType<typeof vi.fn>
}

type WindowWithTelegram = typeof window & { Telegram?: { WebApp?: { MainButton: MockMainButton } } }

function createMockMainButton(): MockMainButton {
  return {
    setText: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    showProgress: vi.fn(),
    hideProgress: vi.fn(),
    onClick: vi.fn(),
    offClick: vi.fn(),
  }
}

function installMockTelegram(): MockMainButton {
  const mainButton = createMockMainButton()
  ;(window as WindowWithTelegram).Telegram = { WebApp: { MainButton: mainButton } }
  return mainButton
}

const t = (key: string): string => key

afterEach(() => {
  delete (window as WindowWithTelegram).Telegram
})

describe('useMainButton — вне TWA', () => {
  it('возвращает shouldRenderFallback: true и не трогает SDK', () => {
    const { result } = renderHook(() =>
      useMainButton({ t, textKey: 'cart.checkout_cta', disabled: false, loading: false, onClick: vi.fn() }),
    )
    expect(result.current.shouldRenderFallback).toBe(true)
  })
})

describe('useMainButton — в TWA', () => {
  it('возвращает shouldRenderFallback: false, показывает и выставляет текст кнопки', () => {
    const mainButton = installMockTelegram()
    const { result } = renderHook(() =>
      useMainButton({ t, textKey: 'cart.checkout_cta', disabled: false, loading: false, onClick: vi.fn() }),
    )
    expect(result.current.shouldRenderFallback).toBe(false)
    expect(mainButton.setText).toHaveBeenCalledWith(t('cart.checkout_cta'))
    expect(mainButton.show).toHaveBeenCalledTimes(1)
  })

  it('синхронизирует disabled из готового пропа БЕЗ внутреннего пересчёта — disabled: true → disable()', () => {
    const mainButton = installMockTelegram()
    renderHook(() =>
      useMainButton({ t, textKey: 'cart.checkout_cta', disabled: true, loading: false, onClick: vi.fn() }),
    )
    expect(mainButton.disable).toHaveBeenCalledTimes(1)
    expect(mainButton.enable).not.toHaveBeenCalled()
  })

  it('disabled: false → enable()', () => {
    const mainButton = installMockTelegram()
    renderHook(() =>
      useMainButton({ t, textKey: 'cart.checkout_cta', disabled: false, loading: false, onClick: vi.fn() }),
    )
    expect(mainButton.enable).toHaveBeenCalledTimes(1)
    expect(mainButton.disable).not.toHaveBeenCalled()
  })

  it('loading: true → showProgress(), loading: false → hideProgress()', () => {
    const mainButton = installMockTelegram()
    const { rerender } = renderHook(
      (props: { loading: boolean }) =>
        useMainButton({ t, textKey: 'cart.checkout_cta', disabled: false, loading: props.loading, onClick: vi.fn() }),
      { initialProps: { loading: true } },
    )
    expect(mainButton.showProgress).toHaveBeenCalledTimes(1)

    rerender({ loading: false })
    expect(mainButton.hideProgress).toHaveBeenCalledTimes(1)
  })

  it('onClick вызывается ровно один раз на клик по системной кнопке (мок SDK)', () => {
    const mainButton = installMockTelegram()
    const onClick = vi.fn()
    renderHook(() =>
      useMainButton({ t, textKey: 'cart.checkout_cta', disabled: false, loading: false, onClick }),
    )

    expect(mainButton.onClick).toHaveBeenCalledTimes(1)
    const registeredHandler = mainButton.onClick.mock.calls[0]?.[0] as () => void
    registeredHandler()

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('переподписывает onClick при смене ссылки на функцию (offClick старого + onClick нового)', () => {
    const mainButton = installMockTelegram()
    const firstOnClick = vi.fn()
    const secondOnClick = vi.fn()
    const { rerender } = renderHook(
      (props: { onClick: () => void }) =>
        useMainButton({ t, textKey: 'cart.checkout_cta', disabled: false, loading: false, onClick: props.onClick }),
      { initialProps: { onClick: firstOnClick } },
    )

    rerender({ onClick: secondOnClick })

    expect(mainButton.offClick).toHaveBeenCalledWith(firstOnClick)
    expect(mainButton.onClick).toHaveBeenLastCalledWith(secondOnClick)
  })
})
