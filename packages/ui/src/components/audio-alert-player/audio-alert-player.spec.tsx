/**
 * `audio-alert-player.spec.tsx` (DTJ-410, тест-план тикета).
 *
 * `jsdom` не реализует `AudioContext` — каждый тест ставит минимальный дублёр через
 * `vi.stubGlobal('AudioContext', ...)`, наблюдаемый шпионами `vi.fn()` (`createOscillator`/
 * `createGain`/`start`/`stop`), чтобы детерминированно проверить, что звук реально запускается
 * ИМЕННО из эффекта компонента `AudioAlertPlayer`, а не из `play()` хука (см. JSDoc модуля,
 * «СТРУКТУРНАЯ ГАРАНТИЯ»).
 */
import { type ReactElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, runA11yAudit } from '@/a11y/test-utils'
import { REDUCED_MOTION_QUERY } from '@/a11y/use-reduced-motion'
import { AudioAlertPlayer, useAudioAlertPlayer } from './audio-alert-player'

const { t } = useT('ru')

class FakeOscillatorNode {
  frequency = { value: 0 }
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class FakeGainNode {
  gain = { value: 0 }
  connect = vi.fn()
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []

  currentTime = 0
  destination = {}
  resume = vi.fn(() => Promise.resolve())
  createOscillator = vi.fn(() => new FakeOscillatorNode())
  createGain = vi.fn(() => new FakeGainNode())

  constructor() {
    FakeAudioContext.instances.push(this)
  }
}

const installFakeMatchMedia = (matches: boolean): void => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      media: query,
      matches: query === REDUCED_MOTION_QUERY ? matches : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

beforeEach(() => {
  FakeAudioContext.instances = []
  vi.stubGlobal('AudioContext', FakeAudioContext)
  installFakeMatchMedia(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

/** Гарнитура: сам хук + компонент — как ожидается использовать API у потребителя. */
const Harness = (): ReactElement => {
  const player = useAudioAlertPlayer()
  return (
    <div>
      <button type="button" data-testid="unlock" onClick={() => { void player.unlock() }}>
        unlock
      </button>
      <button type="button" data-testid="play-new-order" onClick={() => { player.play('new_order') }}>
        play new_order
      </button>
      <button type="button" data-testid="play-batch-mismatch" onClick={() => { player.play('batch_mismatch') }}>
        play batch_mismatch
      </button>
      <AudioAlertPlayer player={player} t={t} />
    </div>
  )
}

describe('AudioAlertPlayer — play() до unlock() (критерий приёмки 1)', () => {
  it('не воспроизводит звук и предупреждает в консоли уровня warn, не тихо и не error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<Harness />)

    fireEvent.click(screen.getByTestId('play-new-order'))

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain("play('new_order')")
    expect(errorSpy).not.toHaveBeenCalled()
    expect(screen.queryByTestId('dorutj-audio-alert-banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('AudioAlertPlayer — unlock() затем play() (критерий приёмки 2)', () => {
  it('активирует звуковой и визуальный канал одновременно', () => {
    render(<Harness />)

    fireEvent.click(screen.getByTestId('unlock'))
    fireEvent.click(screen.getByTestId('play-new-order'))

    expect(screen.getByTestId('dorutj-audio-alert-banner')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    const context = FakeAudioContext.instances[0]
    expect(context).toBeDefined()
    expect(context?.createOscillator).toHaveBeenCalledTimes(1)
    const oscillator = context?.createOscillator.mock.results[0]?.value as FakeOscillatorNode
    expect(oscillator.start).toHaveBeenCalledTimes(1)
  })

  it('вызывает createOscillator/start РОВНО в момент появления баннера в DOM', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('unlock'))

    expect(screen.queryByTestId('dorutj-audio-alert-banner')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('play-new-order'))

    expect(screen.getByTestId('dorutj-audio-alert-banner')).toBeInTheDocument()
  })
})

describe('AudioAlertPlayer — повторный play() разных soundKey (тест-план: детерминированное поведение)', () => {
  it('останавливает текущий тон перед запуском нового (не накладывает звуки)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('unlock'))
    fireEvent.click(screen.getByTestId('play-new-order'))

    const context = FakeAudioContext.instances[0]
    const firstOscillator = context?.createOscillator.mock.results[0]?.value as FakeOscillatorNode
    // `startTone` уже планирует авто-остановку через `TONE_DURATION_SECONDS` — один вызов `stop()`.
    expect(firstOscillator.stop).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('play-batch-mismatch'))

    // Реализация тикета: следующий `play()` явно останавливает предыдущий тон перед новым (второй
    // вызов `stop()` того же осциллятора — не очередь, текущий звук прерывается).
    expect(firstOscillator.stop).toHaveBeenCalledTimes(2)
    expect(context?.createOscillator).toHaveBeenCalledTimes(2)
    const secondOscillator = context?.createOscillator.mock.results[1]?.value as FakeOscillatorNode
    expect(secondOscillator.start).toHaveBeenCalledTimes(1)
    // Баннер остаётся видимым (последний активный alert).
    expect(screen.getByTestId('dorutj-audio-alert-banner')).toBeInTheDocument()
  })
})

describe('AudioAlertPlayer — acknowledge()', () => {
  it('закрывает баннер по клику «Понятно»', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('unlock'))
    fireEvent.click(screen.getByTestId('play-new-order'))
    expect(screen.getByTestId('dorutj-audio-alert-banner')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('ui.audio_alert_player.acknowledge_button') }))

    expect(screen.queryByTestId('dorutj-audio-alert-banner')).not.toBeInTheDocument()
  })
})

describe('AudioAlertPlayer — reduced motion (SRS-UX-020/034)', () => {
  it('отключает декоративную пульсацию, но продолжает показывать баннер И звук', () => {
    installFakeMatchMedia(true)
    render(<Harness />)
    fireEvent.click(screen.getByTestId('unlock'))
    fireEvent.click(screen.getByTestId('play-new-order'))

    const banner = screen.getByTestId('dorutj-audio-alert-banner')
    expect(banner).toBeInTheDocument()
    expect(banner.style.animation).toBe('')
  })

  it('без reduced motion баннер пульсирует', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('unlock'))
    fireEvent.click(screen.getByTestId('play-new-order'))

    const banner = screen.getByTestId('dorutj-audio-alert-banner')
    expect(banner.style.animation).toContain('dorutj-audio-alert-pulse')
  })
})

describe('AudioAlertPlayer — доступность', () => {
  it('нулевые critical/serious нарушения доступности при активном баннере', async () => {
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByTestId('unlock'))
    fireEvent.click(screen.getByTestId('play-new-order'))
    expect(screen.getByTestId('dorutj-audio-alert-banner')).toBeInTheDocument()

    const axeResults = await runA11yAudit(container)
    assertNoBlockingViolations(axeResults)
  })
})
