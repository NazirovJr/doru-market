/**
 * `use-back-button.ts` (DTJ-411, `SRS-UX-045`, §9.1) — тонкая обвязка над системной `BackButton`
 * хоста. Хук НЕ знает про роутинг — «корневой/вложенный» решает потребитель через `isVisible`
 * (скрыта на `/`, `/cart`, `/orders`, `/profile`, видима на вложенных маршрутах).
 *
 * Given обычный веб (`isTwaRuntime() === false`) — no-op, мок SDK не вызывается вовсе (нет
 * системной кнопки назад, потребитель рендерит обычную стрелку в шапке через уже существующий
 * паттерн, вне этого хука).
 */
import { useEffect } from 'react'
import { isTwaRuntime } from './is-twa-runtime'
import { getTelegramWebApp, type TelegramBackButton } from './telegram-webapp-types'

export interface UseBackButtonOptions {
  readonly isVisible: boolean
  readonly onClick: () => void
}

function withBackButton(callback: (backButton: TelegramBackButton) => void): void {
  const backButton = getTelegramWebApp()?.BackButton
  if (backButton !== undefined) {
    callback(backButton)
  }
}

export function useBackButton(options: UseBackButtonOptions): void {
  const { isVisible, onClick } = options
  const twa = isTwaRuntime()

  useEffect(() => {
    if (!twa) {
      return
    }
    withBackButton((backButton) => {
      if (isVisible) {
        backButton.show()
      } else {
        backButton.hide()
      }
    })
  }, [twa, isVisible])

  useEffect(() => {
    if (!twa) {
      return
    }
    withBackButton((backButton) => {
      backButton.onClick(onClick)
    })
    return () => {
      withBackButton((backButton) => {
        backButton.offClick(onClick)
      })
    }
  }, [twa, onClick])
}
