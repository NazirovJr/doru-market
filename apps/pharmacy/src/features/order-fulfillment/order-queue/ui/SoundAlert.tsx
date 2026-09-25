import { forwardRef, useImperativeHandle, useRef, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import alertSoundUrl from '../assets/new-order-alert.wav'

const SOUND_UNLOCKED_STORAGE_KEY = 'dorutj.pharmacy.order-queue.sound-unlocked'

export interface SoundAlertHandle {
  readonly notifyNewOrder: () => void
}

function readUnlockedFlag(): boolean {
  try {
    return window.sessionStorage.getItem(SOUND_UNLOCKED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistUnlockedFlag(): void {
  try {
    window.sessionStorage.setItem(SOUND_UNLOCKED_STORAGE_KEY, '1')
  } catch {
    // best-effort
  }
}

// Жест-триггер разблокировки автовоспроизведения — кнопка «Начать смену», один раз за сессию (sessionStorage).
export const SoundAlert = forwardRef<SoundAlertHandle>((_props, ref): ReactElement => {
  const { t } = useT('tj')
  const audioRef = useRef<HTMLAudioElement>(null)
  const [unlocked, setUnlocked] = useState(readUnlockedFlag)

  useImperativeHandle(ref, () => ({
    notifyNewOrder: (): void => {
      if (!unlocked || audioRef.current === null) return
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => undefined) // NotAllowedError не должен ронять UI
    },
  }))

  function handleUnlock(): void {
    const audio = audioRef.current
    if (audio !== null) {
      audio
        .play()
        .then(() => { audio.pause(); audio.currentTime = 0 })
        .catch(() => undefined)
    }
    setUnlocked(true)
    persistUnlockedFlag()
  }

  return (
    <div data-testid="sound-alert-gate">
      <audio ref={audioRef} src={alertSoundUrl} preload="auto" data-testid="sound-alert-audio" />
      {unlocked ? null : (
        <button
          type="button"
          onClick={handleUnlock}
          data-testid="start-shift-button"
          className="min-h-[56px] w-full rounded-md bg-brand-primary px-4 text-sm font-semibold text-white"
        >
          {t('pharmacy.order_queue.sound_gate.start_shift_cta')}
        </button>
      )}
    </div>
  )
})

SoundAlert.displayName = 'SoundAlert'
