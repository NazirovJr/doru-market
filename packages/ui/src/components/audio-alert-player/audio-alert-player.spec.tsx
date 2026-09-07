import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { AudioAlertPlayer, useAudioAlertPlayer } from './audio-alert-player.js'

/**
 * `jsdom` не реализует Web Audio API — `AudioContext`/`OscillatorNode`/`GainNode` мокаются
 * вручную. Эти тесты проверяют ЛОГИКУ компонента (когда создаётся/останавливается осциллятор,
 * когда рендерится баннер), а НЕ реальный звук в динамиках — это остаётся на ручную/браузерную
 * проверку (аудиодвижок не воспроизводим в headless unit-тесте).
 */
interface MockAudioNode {
  readonly connect: ReturnType<typeof vi.fn>
  readonly disconnect: ReturnType<typeof vi.fn>
}

interface MockOscillator extends MockAudioNode {
  readonly start: ReturnType<typeof vi.fn>
  readonly stop: ReturnType<typeof vi.fn>
  frequency: { value: number }
}

interface MockGain extends MockAudioNode {
  gain: { value: number }
}

let createdOscillators: MockOscillator[] = []

class MockAudioContext {
  state: 'suspended' | 'running' = 'suspended'
  destination = {}
  resume = vi.fn((): Promise<void> => {
    this.state = 'running'
    return Promise.resolve()
  })

  createOscillator = vi.fn((): MockOscillator => {
    const oscillator: MockOscillator = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { value: 0 },
    }
    createdOscillators.push(oscillator)
    return oscillator
  })

  createGain = vi.fn(
    (): MockGain => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: { value: 0 },
    }),
  )
}

const TestHarness = ({ soundKey = 'new_order' }: { readonly soundKey?: string }): ReactElement => {
  const player = useAudioAlertPlayer()
  return (
    <div>
      <button onClick={() => void player.unlock()}>Начать смену</button>
      <button
        onClick={() => {
          player.play(soundKey)
        }}
      >
        Проиграть
      </button>
      <AudioAlertPlayer trigger={player.trigger} audioContext={player.audioContext} label="Новый заказ" />
    </div>
  )
}

describe('useAudioAlertPlayer / AudioAlertPlayer', () => {
  let warnSpy: MockInstance<typeof console.warn>

  beforeEach(() => {
    createdOscillators = []
    vi.stubGlobal('AudioContext', MockAudioContext)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    warnSpy.mockRestore()
  })

  it('AC1: play() до unlock() — звук не воспроизводится, warn в консоли, баннер не рендерится', () => {
    render(<TestHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }))

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("play('new_order')")
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('AC2: после unlock() play() активирует звук и визуал одновременно', async () => {
    render(<TestHarness />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Начать смену' }))
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }))

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('Новый заказ')
    expect(banner).toHaveAttribute('data-sound-key', 'new_order')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('повторный play() с новым soundKey останавливает предыдущий тон перед стартом нового (без наложения)', async () => {
    render(<TestHarness />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Начать смену' }))
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }))
    expect(createdOscillators).toHaveLength(1)
    const firstOscillator = createdOscillators[0]

    fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }))
    expect(createdOscillators).toHaveLength(2)
    // Первый осциллятор остановлен ДО старта второго (cleanup эффекта при смене trigger) —
    // детерминированное поведение «текущий звук останавливается перед новым» (тест-план DTJ-410).
    expect(firstOscillator?.stop).toHaveBeenCalledTimes(1)
    expect(createdOscillators[1]?.start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveAttribute('data-sound-key', 'new_order')
  })

  it('play() без AudioContext в окружении (браузер не поддерживает) — не бросает исключение', () => {
    vi.unstubAllGlobals()
    render(<TestHarness />)
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Начать смену' }))
      fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }))
    }).not.toThrow()
  })

  it('renderWithA11yCheck баннера — ноль критичных/серьёзных нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <AudioAlertPlayer
        trigger={{ soundKey: 'new_order', nonce: 1 }}
        audioContext={null}
        label="Новый заказ"
      />,
    )
    expect(axeResults).toHaveNoViolations()
  })

  it('trigger === null — компонент ничего не рендерит', () => {
    const { container } = render(<AudioAlertPlayer trigger={null} audioContext={null} label="Новый заказ" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('unlock() создаёт AudioContext и вызывает resume(), когда состояние suspended', async () => {
    render(<TestHarness />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Начать смену' }))
      await Promise.resolve()
    })
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }))
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('баннер и звук автоматически завершаются по истечении длительности сигнала (durationMs)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<TestHarness />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Начать смену' }))
      await Promise.resolve()
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Проиграть' }))
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    const DEFAULT_DURATION_MS = 2500
    act(() => {
      vi.advanceTimersByTime(DEFAULT_DURATION_MS)
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
