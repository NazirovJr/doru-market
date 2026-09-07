import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './audio-alert-player.css'

/** Один сигнал = уникальный `soundKey` + монотонный `nonce` — `nonce` гарантирует, что повторный
 * `play()` с ТЕМ ЖЕ `soundKey` подряд всё равно считается новым событием (React иначе не увидит
 * изменения состояния при равных примитивах). */
export interface AudioAlertTrigger {
  readonly soundKey: string
  readonly nonce: number
}

export interface UseAudioAlertPlayerOptions {
  /** Как долго звучит сигнал и виден баннер, мс. По умолчанию 2500 (`DEFAULT_DURATION_MS`). */
  readonly durationMs?: number
}

export interface UseAudioAlertPlayerResult {
  readonly isUnlocked: boolean
  /** Текущий активный сигнал или `null` — прокидывается ЦЕЛИКОМ в `<AudioAlertPlayer trigger={...}
   * audioContext={...} />`; звук физически возникает ТОЛЬКО внутри этого компонента (создание
   * `OscillatorNode` живёт там, не здесь) — вызвать звук, минуя рендер визуального баннера,
   * через публичный API (`play()`) невозможно (DoD DTJ-410). */
  readonly trigger: AudioAlertTrigger | null
  /** Инстанс `AudioContext`, созданный `unlock()` — деталь связывания хука с `<AudioAlertPlayer>`,
   * не самостоятельный публичный канал звука (см. `trigger` выше). */
  readonly audioContext: AudioContext | null
  /**
   * Разблокирует `AudioContext` жестом пользователя (например, клик «Начать смену»).
   *
   * ВАЖНО (мобильный Safari/iOS особенно строг): вызывайте эту функцию СИНХРОННО внутри
   * обработчика РЕАЛЬНОГО пользовательского жеста (`onClick`/`onPointerUp`) — до любого `await` в
   * том же обработчике. Если между жестом и созданием/`resume()` `AudioContext` окажется `await`
   * (например, `await someApiCall(); unlock()`), браузер не засчитает разблокировку как связанную
   * с жестом и снова заблокирует звук.
   */
  readonly unlock: () => Promise<void>
  /** Звук ТОЛЬКО после `unlock()` — до него `play()` no-op с предупреждением уровня `warn` в
   * консоли (AC1), не тихий провал. */
  readonly play: (soundKey: string) => void
}

const DEFAULT_DURATION_MS = 2500

type AudioContextConstructor = new () => AudioContext

/** DOM lib типизирует `Window.AudioContext` как всегда присутствующий — в реальности старые
 * WebView могут его не иметь (см. `webkitAudioContext`, легаси-префикс Safari), поэтому оба поля
 * здесь намеренно `?:` для честной проверки в рантайме, а не полагаются на типы `lib.dom.d.ts`. */
interface MaybeAudioContextWindow {
  readonly AudioContext?: AudioContextConstructor
  readonly webkitAudioContext?: AudioContextConstructor
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null
  }
  const globalWindow = window as unknown as MaybeAudioContextWindow
  return globalWindow.AudioContext ?? globalWindow.webkitAudioContext ?? null
}

/**
 * `SRS-UX-007`: хук управляет разблокировкой/жизненным циклом сигнала (`unlock`/`play`), но НЕ
 * создаёт звук сам по себе — фактическое воспроизведение (`AudioContext.createOscillator()`)
 * происходит внутри `<AudioAlertPlayer>` синхронно с рендером визуального баннера (см. JSDoc
 * `trigger`). Placeholder-тон, не финальный звуковой ассет — см. JSDoc `AudioAlertPlayer`.
 */
export function useAudioAlertPlayer(options: UseAudioAlertPlayerOptions = {}): UseAudioAlertPlayerResult {
  const { durationMs = DEFAULT_DURATION_MS } = options
  const audioContextRef = useRef<AudioContext | null>(null)
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nonceRef = useRef(0)
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [trigger, setTrigger] = useState<AudioAlertTrigger | null>(null)

  const unlock = useCallback(async (): Promise<void> => {
    const AudioContextConstructorRef = getAudioContextConstructor()
    if (AudioContextConstructorRef === null) {
      return
    }
    if (audioContextRef.current === null) {
      audioContextRef.current = new AudioContextConstructorRef()
      setAudioContext(audioContextRef.current)
    }
    const context = audioContextRef.current
    if (context.state === 'suspended') {
      await context.resume()
    }
    setIsUnlocked(true)
  }, [])

  const play = useCallback(
    (soundKey: string): void => {
      if (!isUnlocked) {
        // eslint-disable-next-line no-console -- намеренное предупреждение о вызове play() до unlock() (AC1, DTJ-410) — не тихий провал, помогает диагностировать заблокированное автовоспроизведение
        console.warn(
          `useAudioAlertPlayer: play('${soundKey}') проигнорирован — unlock() ещё не вызван (браузер блокирует звук до жеста пользователя).`,
        )
        return
      }
      if (dismissTimeoutRef.current !== null) {
        clearTimeout(dismissTimeoutRef.current)
      }
      nonceRef.current += 1
      setTrigger({ soundKey, nonce: nonceRef.current })
      dismissTimeoutRef.current = setTimeout(() => {
        setTrigger(null)
      }, durationMs)
    },
    [isUnlocked, durationMs],
  )

  useEffect(
    () => (): void => {
      if (dismissTimeoutRef.current !== null) {
        clearTimeout(dismissTimeoutRef.current)
      }
    },
    [],
  )

  return { isUnlocked, trigger, audioContext, unlock, play }
}

const TONE_FREQUENCY_HZ = 880
const TONE_GAIN = 0.15

export interface AudioAlertPlayerProps {
  /** Из `useAudioAlertPlayer().trigger` — компонент рендерит баннер И запускает тон РОВНО когда
   * это не `null`, одним и тем же обновлением (AC2). */
  readonly trigger: AudioAlertTrigger | null
  /** Из `useAudioAlertPlayer().audioContext`. */
  readonly audioContext: AudioContext | null
  /** Текст баннера (например, «Новый заказ») — уже переведённый текст потребителя. */
  readonly label: ReactNode
  readonly className?: string
}

/**
 * Единственный визуальный+звуковой канал критичных событий терминала аптеки (`SRS-UX-007`):
 * пульсирующий баннер рендерится ОДНОВРЕМЕННО со звуком — оба живут в одном компоненте, поэтому
 * программно вызвать звук без визуала через публичный API невозможно (звук возникает только в
 * этом `useEffect`, который выполняется в той же реакции на `trigger`, что и JSX баннера ниже).
 *
 * Placeholder-звук — короткий синтетический тон (`AudioContext.createOscillator()`), НЕ финальный
 * звуковой ассет: ни один SRS-документ не специфицирует конкретный файл (пробел требований, см.
 * «Риски» DTJ-410). Финальный ассет — доработка EP-12 (веб-кабинет аптеки), первого реального
 * потребителя этого компонента.
 *
 * Пульсация баннера уважает `useReducedMotion()` (класс `--pulsing` не добавляется), звук — НЕТ:
 * это функциональный сигнал, а не декоративная анимация (`SRS-UX-034` — функциональные переходы
 * сокращаются до мгновенной смены, не отключаются полностью; здесь «сокращение» неприменимо к
 * звуку как каналу, поэтому он воспроизводится независимо от системной настройки).
 */
export const AudioAlertPlayer = ({ trigger, audioContext, label, className }: AudioAlertPlayerProps): ReactElement | null => {
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (trigger === null || audioContext === null) {
      return undefined
    }

    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    oscillator.frequency.value = TONE_FREQUENCY_HZ
    gain.gain.value = TONE_GAIN
    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start()

    return (): void => {
      oscillator.stop()
      oscillator.disconnect()
      gain.disconnect()
    }
  }, [trigger, audioContext])

  if (trigger === null) {
    return null
  }

  return (
    <div
      role="alert"
      data-sound-key={trigger.soundKey}
      className={cx('ui-audio-alert-player', !prefersReducedMotion && 'ui-audio-alert-player--pulsing', className)}
    >
      {label}
    </div>
  )
}
