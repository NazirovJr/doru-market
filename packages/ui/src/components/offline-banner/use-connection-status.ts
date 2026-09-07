import { useEffect } from 'react'

/** `SRS-UX-025`: REST-поллинг раз в 10с как деградация при потере WS-соединения. */
export const DEFAULT_POLL_INTERVAL_MS = 10_000

export interface UseConnectionStatusOptions {
  /** Текущее состояние WS-соединения (владеет фича, не хук — `use-connection-status.ts` не знает
   * протокол WS, только реагирует на булево состояние, тикет п.7 «тонкая переиспользуемая логика,
   * не привязанная к конкретному экрану»). */
  readonly isWsConnected: boolean
  /** Вызывается на каждом тике REST-поллинга, пока `isWsConnected === false` — фича передаёт свой
   * REST catch-up запрос (`SRS-PHT-037`). */
  readonly onPoll: () => void
  readonly pollIntervalMs?: number
}

/**
 * `SRS-UX-025`: для веб-кабинета аптеки (`/admin/order-queue`) при потере WS-соединения — активный
 * REST-поллинг раз в 10 секунд как деградация (не полагаться только на переподключение WS), пока
 * `auth_ok`/WS не восстановлены. Хук ТОЛЬКО планирует таймер — баннер «Нет соединения» рендерит
 * потребитель через `OfflineBanner`/собственный текст (тикет: этот хук не привязан к экрану).
 */
export function useConnectionStatus(options: UseConnectionStatusOptions): void {
  const { isWsConnected, onPoll, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options

  useEffect(() => {
    if (isWsConnected) {
      return undefined
    }

    const intervalId = window.setInterval(onPoll, pollIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isWsConnected, onPoll, pollIntervalMs])
}
