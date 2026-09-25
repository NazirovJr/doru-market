import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SoundAlert, type SoundAlertHandle } from './SoundAlert'

/**
 * DoD DTJ-310: «звук воспроизводится только после явного жеста, нет console-ошибок NotAllowedError».
 * jsdom не реализует `HTMLMediaElement.play()` — стаб ниже нужен ЛЮБОМУ тесту, где `<audio>` рендерится
 * (не специфика этого файла).
 */
let playMock: ReturnType<typeof vi.fn<() => Promise<void>>>

beforeEach(() => {
  playMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.play = playMock
  HTMLMediaElement.prototype.pause = vi.fn<() => void>()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('<SoundAlert /> (DTJ-310, «Что сделать» п.5)', () => {
  it('до жеста пользователя показывает «Начать смену», звук НЕ проигрывается сам по себе', () => {
    render(<SoundAlert />)
    expect(screen.getByTestId('start-shift-button')).toBeInTheDocument()
    expect(playMock).not.toHaveBeenCalled()
  })

  it('клик «Начать смену» — разблокирует звук (play+pause жестом) и скрывает кнопку', () => {
    render(<SoundAlert />)
    fireEvent.click(screen.getByTestId('start-shift-button'))

    expect(playMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('start-shift-button')).not.toBeInTheDocument()
  })

  it('после разблокировки notifyNewOrder() реально проигрывает звук', () => {
    const ref = createRef<SoundAlertHandle>()
    render(<SoundAlert ref={ref} />)
    fireEvent.click(screen.getByTestId('start-shift-button'))
    playMock.mockClear()

    ref.current?.notifyNewOrder()

    expect(playMock).toHaveBeenCalledTimes(1)
  })

  it('ДО разблокировки notifyNewOrder() ничего не проигрывает (нет автовоспроизведения без жеста)', () => {
    const ref = createRef<SoundAlertHandle>()
    render(<SoundAlert ref={ref} />)

    ref.current?.notifyNewOrder()

    expect(playMock).not.toHaveBeenCalled()
  })

  it('play() падает с NotAllowedError — не пробрасывается дальше (DoD: без console-ошибок)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    playMock.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
    const ref = createRef<SoundAlertHandle>()
    render(<SoundAlert ref={ref} />)
    fireEvent.click(screen.getByTestId('start-shift-button'))

    expect(() => { ref.current?.notifyNewOrder() }).not.toThrow()
    await Promise.resolve()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
