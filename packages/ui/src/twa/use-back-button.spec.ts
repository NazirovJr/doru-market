/**
 * `use-back-button.spec.ts` (DTJ-411, тест-план «Unit»).
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBackButton } from './use-back-button'

interface MockBackButton {
  readonly show: ReturnType<typeof vi.fn>
  readonly hide: ReturnType<typeof vi.fn>
  readonly onClick: ReturnType<typeof vi.fn>
  readonly offClick: ReturnType<typeof vi.fn>
}

type WindowWithTelegram = typeof window & { Telegram?: { WebApp?: { BackButton: MockBackButton } } }

function installMockTelegram(): MockBackButton {
  const backButton: MockBackButton = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() }
  ;(window as WindowWithTelegram).Telegram = { WebApp: { BackButton: backButton } }
  return backButton
}

afterEach(() => {
  delete (window as WindowWithTelegram).Telegram
})

describe('useBackButton — вне TWA', () => {
  it('no-op: мок SDK не вызывается вовсе', () => {
    expect(() => {
      renderHook(() => {
        useBackButton({ isVisible: true, onClick: vi.fn() })
      })
    }).not.toThrow()
  })
})

describe('useBackButton — в TWA, страница /cart (корневой таб)', () => {
  it('isVisible: false → hide() вызвана, НЕ show()', () => {
    const backButton = installMockTelegram()
    renderHook(() => {
      useBackButton({ isVisible: false, onClick: vi.fn() })
    })
    expect(backButton.hide).toHaveBeenCalledTimes(1)
    expect(backButton.show).not.toHaveBeenCalled()
  })
})

describe('useBackButton — в TWA, вложенный маршрут', () => {
  it('isVisible: true → show() вызвана, НЕ hide()', () => {
    const backButton = installMockTelegram()
    renderHook(() => {
      useBackButton({ isVisible: true, onClick: vi.fn() })
    })
    expect(backButton.show).toHaveBeenCalledTimes(1)
    expect(backButton.hide).not.toHaveBeenCalled()
  })

  it('onClick регистрируется один раз и вызывается при клике по системной кнопке', () => {
    const backButton = installMockTelegram()
    const onClick = vi.fn()
    renderHook(() => {
      useBackButton({ isVisible: true, onClick })
    })

    expect(backButton.onClick).toHaveBeenCalledTimes(1)
    const registeredHandler = backButton.onClick.mock.calls[0]?.[0] as () => void
    registeredHandler()

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('переподписывает onClick при смене ссылки на функцию', () => {
    const backButton = installMockTelegram()
    const firstOnClick = vi.fn()
    const secondOnClick = vi.fn()
    const { rerender } = renderHook(
      (props: { onClick: () => void }) => {
        useBackButton({ isVisible: true, onClick: props.onClick })
      },
      { initialProps: { onClick: firstOnClick } },
    )

    rerender({ onClick: secondOnClick })

    expect(backButton.offClick).toHaveBeenCalledWith(firstOnClick)
    expect(backButton.onClick).toHaveBeenLastCalledWith(secondOnClick)
  })
})
