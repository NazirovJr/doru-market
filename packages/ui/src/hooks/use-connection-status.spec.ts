/**
 * `use-connection-status.spec.ts` (DTJ-406, `SRS-UX-025`).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStatus } from './use-connection-status'

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  vi.unstubAllGlobals()
})

describe('useConnectionStatus — isOnline из navigator.onLine + события online/offline', () => {
  it('трактует среду без navigator.onLine как «онлайн»', () => {
    vi.stubGlobal('navigator', {})
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current.isOnline).toBe(true)
  })

  it('начальное значение читает navigator.onLine', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current.isOnline).toBe(false)
    expect(result.current.mode).toBe('offline')
  })

  it('реагирует на событие window.offline/online', () => {
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current.isOnline).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.isOnline).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current.isOnline).toBe(true)
  })
})

describe('useConnectionStatus — mode (offline/polling/realtime)', () => {
  it('polling — онлайн, но WS не подключён (значение по умолчанию)', () => {
    const { result } = renderHook(() => useConnectionStatus())
    expect(result.current.mode).toBe('polling')
    expect(result.current.isWsConnected).toBe(false)
  })

  it('realtime — онлайн И WS подключён (reportWsConnected)', () => {
    const { result } = renderHook(() => useConnectionStatus())
    act(() => { result.current.reportWsConnected() })
    expect(result.current.mode).toBe('realtime')
    expect(result.current.isWsConnected).toBe(true)
  })

  it('offline побеждает даже при подключённом WS', () => {
    const { result } = renderHook(() => useConnectionStatus())
    act(() => { result.current.reportWsConnected() })
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(result.current.mode).toBe('offline')
  })

  it('reportWsDisconnected возвращает mode к polling', () => {
    const { result } = renderHook(() => useConnectionStatus())
    act(() => { result.current.reportWsConnected() })
    act(() => { result.current.reportWsDisconnected() })
    expect(result.current.mode).toBe('polling')
  })
})
