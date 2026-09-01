/**
 * `telegram-webapp.spec.ts` (EP-01, DTJ-028.5) — unit-тест detection-логики
 * Telegram Mini App.
 *
 * Сценарии:
 *   1. `window.Telegram === undefined` (обычный браузер) → `isTelegramWebApp() === false`;
 *   2. `window.Telegram.WebApp === undefined` → `false`;
 *   3. `initData` пустая → `false` (мусор от расширений);
 *   4. `initData` короткая (<10 символов) → `false`;
 *   5. `initData` нормальная (≥10) → `true`;
 *   6. `getInitData()` бросает, если WebApp недоступен;
 *   7. `getInitData()` возвращает `initData`, если WebApp доступен.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getInitData, isTelegramWebApp } from './telegram-webapp.js'

const VALID_INIT_DATA = 'user=%7B%22id%22%3A123%7D&auth_date=1700000000&hash=abc123def456'

describe('telegram-webapp (DTJ-028.5)', () => {
  // `window.Telegram` нельзя `delete` если его нет — сохраняем оригинал.
  const originalTelegram = (globalThis as { window?: Window }).window?.Telegram

  beforeEach(() => {
    delete (window as { Telegram?: unknown }).Telegram
  })

  afterEach(() => {
    if (originalTelegram === undefined) {
      delete (window as { Telegram?: unknown }).Telegram
    } else {
      ;(window as { Telegram?: unknown }).Telegram = originalTelegram
    }
  })

  it('1. window.Telegram === undefined → false (обычный браузер)', () => {
    expect(isTelegramWebApp()).toBe(false)
  })

  it('2. window.Telegram.WebApp === undefined → false', () => {
    ;(window as { Telegram?: unknown }).Telegram = {}
    expect(isTelegramWebApp()).toBe(false)
  })

  it('3. initData пустая → false (мусор от расширений)', () => {
    ;(window as { Telegram?: unknown }).Telegram = {
      WebApp: { initData: '', initDataUnsafe: {}, close: () => undefined, ready: () => undefined },
    }
    expect(isTelegramWebApp()).toBe(false)
  })

  it('4. initData слишком короткая → false', () => {
    ;(window as { Telegram?: unknown }).Telegram = {
      WebApp: { initData: 'short', initDataUnsafe: {}, close: () => undefined, ready: () => undefined },
    }
    expect(isTelegramWebApp()).toBe(false)
  })

  it('5. initData валидной длины → true', () => {
    ;(window as { Telegram?: unknown }).Telegram = {
      WebApp: {
        initData: VALID_INIT_DATA,
        initDataUnsafe: {},
        close: () => undefined,
        ready: () => undefined,
      },
    }
    expect(isTelegramWebApp()).toBe(true)
  })

  it('6. getInitData() бросает, если WebApp недоступен', () => {
    expect((): string => getInitData()).toThrow('Telegram WebApp is not available')
  })

  it('7. getInitData() возвращает initData, если WebApp доступен', () => {
    ;(window as { Telegram?: unknown }).Telegram = {
      WebApp: {
        initData: VALID_INIT_DATA,
        initDataUnsafe: { user: { id: 1, first_name: 'A' } },
        close: () => undefined,
        ready: () => undefined,
      },
    }
    expect(getInitData()).toBe(VALID_INIT_DATA)
  })
})
