/**
 * `useConnectionStatus` (DTJ-406, «Что сделать» п.7, `SRS-UX-025`) — единый источник статуса
 * сети/реалтайм-соединения для UI. Пакет НЕ содержит собственного WS-клиента: `isOnline` читается
 * из браузерных событий `online`/`offline` (источник для `<OfflineBanner isOnline>`), а статус
 * WS-соединения УПРАВЛЯЕТСЯ потребителем через `reportWsConnected`/`reportWsDisconnected` —
 * конкретная фича (например `apps/pharmacy` order-queue, `SRS-UX-025`) подключает свой сокет и
 * вызывает эти функции на `open`/`close`/`error`, получая единый `mode`:
 * - `'offline'` — браузер офлайн (`SRS-UX-024`, показывать `OfflineBanner`);
 * - `'polling'` — браузер онлайн, но WS не подключен (деградация до REST-поллинга, `SRS-UX-025`);
 * - `'realtime'` — браузер онлайн И WS подключён.
 *
 * Среда без `window`/`navigator` (SSR) трактуется как «онлайн» (`true`) — то же допущение, что
 * `useReducedMotion` для сред без `matchMedia` (см. её JSDoc): предпочтение/статус не заданы
 * не означает «офлайн» по умолчанию.
 */
import { useCallback, useEffect, useState } from 'react'

export type ConnectionMode = 'offline' | 'polling' | 'realtime'

export interface ConnectionStatus {
  readonly isOnline: boolean
  readonly isWsConnected: boolean
  readonly mode: ConnectionMode
  readonly reportWsConnected: () => void
  readonly reportWsDisconnected: () => void
}

const getBrowserOnlineStatus = (): boolean => {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
    return true
  }
  return navigator.onLine
}

const resolveMode = (isOnline: boolean, isWsConnected: boolean): ConnectionMode => {
  if (!isOnline) {
    return 'offline'
  }
  return isWsConnected ? 'realtime' : 'polling'
}

export const useConnectionStatus = (): ConnectionStatus => {
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus)
  const [isWsConnected, setIsWsConnected] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }
    const handleOnline = (): void => {
      setIsOnline(true)
    }
    const handleOffline = (): void => {
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const reportWsConnected = useCallback((): void => {
    setIsWsConnected(true)
  }, [])
  const reportWsDisconnected = useCallback((): void => {
    setIsWsConnected(false)
  }, [])

  return {
    isOnline,
    isWsConnected,
    mode: resolveMode(isOnline, isWsConnected),
    reportWsConnected,
    reportWsDisconnected,
  }
}
