/**
 * `AudioAlertPlayer` (DTJ-410, `SRS-UX-007`/`SRS-UX-020`/`SRS-UX-034`) — единственный в продукте
 * механизм двойного канала для критичных событий терминала аптеки (новый заказ, несовпадение
 * партии/срока годности при сканировании): звук И визуальный сигнал ОБЯЗАНЫ активироваться
 * одновременно, ни один канал не единственный (целевая аудитория персонала аптеки может не
 * смотреть на экран постоянно).
 *
 * ДВЕ ЧАСТИ ОДНОГО API:
 * - `useAudioAlertPlayer()` — хук состояния (`unlock`/`play`/`acknowledge`/`activeAlert`);
 * - `<AudioAlertPlayer player={...} t={t} />` — визуальный компонент, КОТОРЫЙ ЖЕ реально
 *   воспроизводит тон (см. эффект ниже).
 *
 * СТРУКТУРНАЯ ГАРАНТИЯ (DoD тикета п.5 «невозможно вызвать звук без визуала — проверено
 * структурой, не только соглашением»): `play()` хука НЕ воспроизводит звук сам — он только
 * переключает `activeAlert` (состояние). Реальный `AudioContext.createOscillator().start()`
 * вызывается ИСКЛЮЧИТЕЛЬНО внутри `useEffect` ЭТОГО компонента, отслеживающего `activeAlert`.
 * Если `<AudioAlertPlayer>` не смонтирован — `play()` молча меняет состояние, которое никто не
 * читает, и звук физически не звучит. Это делает пару «хук без визуального компонента» немой,
 * а не просто нарушением соглашения в документации.
 *
 * `AudioContext` вместо `<audio autoplay>` — браузеры блокируют автовоспроизведение без
 * предшествующего пользовательского жеста (риск тикета). `unlock()` ОБЯЗАН вызываться СИНХРОННО
 * внутри обработчика реального жеста (клик «Начать смену») — см. JSDoc `unlock()` ниже, Mobile
 * Safari/iOS не засчитывает разблокировку после `await` в том же обработчике.
 *
 * Placeholder-звук — короткий синтетический тон через `AudioContext.createOscillator()` (риск
 * тикета: конкретный звуковой ассет не специфицирован ни одним SRS-документом, пробел требований).
 * Финальный звуковой файл — доработка эпика, реально потребляющего компонент (веб-кабинет аптеки,
 * EP-12) — TODO(EP-12) ниже фиксирует это явно для Storybook-заметки компонента.
 *
 * `prefers-reduced-motion` отключает ТОЛЬКО декоративную пульсацию баннера (`SRS-UX-020`) — звук
 * НЕ отключается: это функциональный сигнал, а не декоративная анимация (`SRS-UX-034`, «функцио-
 * нальные переходы сокращаются до мгновенной смены», не отключаются полностью).
 */
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { type TranslateFunction, type TranslationKey, type TranslationParams } from '@dorutj/i18n'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { Button } from '../button/button'
import './audio-alert-player.css'

const TONE_FREQUENCY_HZ = 880
const TONE_DURATION_SECONDS = 0.6
const TONE_GAIN = 0.2
const PULSE_DURATION_MS = 900
const ICON_SIZE_PX = 24

export interface UseAudioAlertPlayerResult {
  readonly isUnlocked: boolean
  /** `null` — баннер скрыт; иначе — активный `soundKey` последнего `play()`. */
  readonly activeAlert: string | null
  /**
   * Разблокирует `AudioContext`. ОБЯЗАН вызываться СИНХРОННО внутри обработчика реального
   * пользовательского жеста (клик/тап «Начать смену») — НЕ после `await` внутри того же
   * обработчика: иначе Mobile Safari/iOS не засчитывает разблокировку (риск тикета DTJ-410).
   * Возвращённый промис (резолвится, когда `AudioContext.resume()` завершится) можно ожидать
   * для UI-обратной связи — сам ВЫЗОВ метода обязан оставаться синхронным в обработчике.
   */
  readonly unlock: () => Promise<void>
  /**
   * Звук ТОЛЬКО после `unlock()` — до разблокировки no-op с `console.warn` уровня `warn`, НЕ
   * тихий провал (критерий приёмки 1). Реальное воспроизведение тона — в эффекте компонента
   * `AudioAlertPlayer` (см. JSDoc модуля) — `play()` только переключает `activeAlert`.
   */
  readonly play: (soundKey: string) => void
  /** Закрывает визуальный баннер (кнопка «Понятно» — подтверждение персоналом). */
  readonly acknowledge: () => void
  /**
   * `AudioContext`, созданный `unlock()`. ВНУТРЕННЕЕ поле контроллера — читается ТОЛЬКО
   * компонентом `<AudioAlertPlayer player={...} />`. Не вызывайте его методы напрямую —
   * единственный поддерживаемый вход в звуковой канал — пара `unlock()`/`play()` вместе с
   * рендером `<AudioAlertPlayer>` (см. «СТРУКТУРНАЯ ГАРАНТИЯ» в JSDoc модуля).
   */
  readonly audioContext: AudioContext | null
}

export const useAudioAlertPlayer = (): UseAudioAlertPlayerResult => {
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [activeAlert, setActiveAlert] = useState<string | null>(null)

  const unlock = useCallback((): Promise<void> => {
    const context = audioContext ?? new AudioContext()
    if (audioContext === null) {
      setAudioContext(context)
    }
    setIsUnlocked(true)
    return context.resume()
  }, [audioContext])

  const play = useCallback(
    (soundKey: string): void => {
      if (!isUnlocked || audioContext === null) {
        // eslint-disable-next-line no-console -- намеренное dev-предупреждение (критерий приёмки 1): play() до unlock() — no-op, а не тихий провал без объяснения при отладке.
        console.warn(
          `[AudioAlertPlayer] play('${soundKey}') проигнорирован: вызовите unlock() внутри обработчика жеста пользователя перед воспроизведением звука (SRS-UX-007).`,
        )
        return
      }
      setActiveAlert(soundKey)
    },
    [isUnlocked, audioContext],
  )

  const acknowledge = useCallback((): void => {
    setActiveAlert(null)
  }, [])

  return { isUnlocked, activeAlert, unlock, play, acknowledge, audioContext }
}

/** Останавливает осциллятор, если он ещё не завершился сам по `TONE_DURATION_SECONDS`. */
const stopToneSafely = (oscillator: OscillatorNode | null): void => {
  if (oscillator === null) {
    return
  }
  try {
    oscillator.stop()
  } catch {
    // Уже остановлен естественным завершением (`stop(context.currentTime + TONE_DURATION_SECONDS)`
    // сработал раньше) — повторный `stop()` в этом случае бросает `InvalidStateError`, безопасно
    // игнорируется: цель вызова здесь — гарантировать тишину, а не диагностировать состояние узла.
  }
}

const startTone = (context: AudioContext): OscillatorNode => {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = TONE_FREQUENCY_HZ
  gain.gain.value = TONE_GAIN
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + TONE_DURATION_SECONDS)
  return oscillator
}

const BellGlyph = (): ReactElement => (
  <svg aria-hidden="true" width={ICON_SIZE_PX} height={ICON_SIZE_PX} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 4a5 5 0 0 0-5 5v3.3c0 .6-.2 1.1-.6 1.6L5 15.6c-.8 1-.1 2.4 1.1 2.4h11.8c1.2 0 1.9-1.4 1.1-2.4l-1.4-1.7c-.4-.5-.6-1-.6-1.6V9a5 5 0 0 0-5-5Z"
      stroke="var(--brand-danger-text)"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path d="M9.5 20a2.5 2.5 0 0 0 5 0" stroke="var(--brand-danger-text)" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
)

export interface AudioAlertPlayerProps {
  readonly player: UseAudioAlertPlayerResult
  readonly t: TranslateFunction
  /** По умолчанию `ui.audio_alert_player.default_label`. */
  readonly labelKey?: TranslationKey
  readonly labelParams?: TranslationParams
}

const DEFAULT_LABEL_KEY: TranslationKey = 'ui.audio_alert_player.default_label'

/**
 * Визуальный баннер + реальное воспроизведение тона (см. «СТРУКТУРНАЯ ГАРАНТИЯ» в JSDoc модуля).
 * Возвращает `null`, пока `player.activeAlert === null` — банер физически отсутствует в DOM вне
 * активного сигнала (не просто скрыт стилями), что и проверяет критерий приёмки 2.
 */
export const AudioAlertPlayer = ({
  player,
  t,
  labelKey = DEFAULT_LABEL_KEY,
  labelParams,
}: AudioAlertPlayerProps): ReactElement | null => {
  const prefersReducedMotion = useReducedMotion()
  const activeOscillatorRef = useRef<OscillatorNode | null>(null)

  useEffect(() => {
    const context = player.audioContext
    if (player.activeAlert === null || context === null) {
      return
    }
    // Повторный `play()` с другим `soundKey` не накладывает звуки — текущий тон останавливается
    // перед новым (тест-план DTJ-410: «любое детерминированное поведение», выбор реализации —
    // прерывание текущего звука новым, не очередь).
    stopToneSafely(activeOscillatorRef.current)
    activeOscillatorRef.current = startTone(context)
  }, [player.activeAlert, player.audioContext])

  useEffect(
    () => () => {
      stopToneSafely(activeOscillatorRef.current)
    },
    [],
  )

  if (player.activeAlert === null) {
    return null
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="dorutj-audio-alert-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        width: '100%',
        boxSizing: 'border-box',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--brand-danger-bg)',
        border: '1px solid var(--brand-danger-border)',
        color: 'var(--brand-danger-text)',
        fontFamily: 'var(--brand-font-family)',
        fontSize: 'var(--font-size-md)',
        fontWeight: 'var(--font-weight-semibold)',
        // Декоративная пульсация ОТКЛЮЧАЕТСЯ reduced-motion (SRS-UX-020) — звук (эффект выше)
        // НЕ зависит от этого флага (SRS-UX-034: функциональный сигнал, не декорация).
        animation: prefersReducedMotion
          ? undefined
          : `dorutj-audio-alert-pulse ${String(PULSE_DURATION_MS)}ms ease-in-out infinite`,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <BellGlyph />
        {t(labelKey, labelParams)}
      </span>
      <Button variant="secondary" onClick={player.acknowledge}>
        {t('ui.audio_alert_player.acknowledge_button')}
      </Button>
    </div>
  )
}

// TODO(EP-12): placeholder-тон (`createOscillator`) — заменить на итоговый звуковой ассет
// веб-кабинета аптеки, когда он появится в дизайн-системе (JSDoc модуля, «Риски и подводные
// камни» DTJ-410) — зафиксировать в Storybook-заметке компонента при добавлении Storybook-файла.
