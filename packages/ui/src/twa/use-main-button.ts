/**
 * `use-main-button.ts` (DTJ-411, `SRS-UX-045/046`) — тонкая презентационная обвязка над системной
 * `MainButton` хоста. НЕ вычисляет `disabled`/`loading` — принимает готовые значения, уже
 * посчитанные `model/`-логикой экрана (та же логика, что у обычной `<Button>`, `SRS-UX-046`).
 *
 * Given TWA (`isTwaRuntime() === true`) — хук управляет системной `MainButton`: текст (через `t`/
 * `textKey`, пакет не владеет локалью — тот же паттерн, что `EmptyState`/`ErrorState`, DTJ-406),
 * `disabled`→`enable()`/`disable()`, `loading`→`showProgress()`/`hideProgress()`, клик — РОВНО один
 * обработчик на актуальный `onClick` (переподписка при смене ссылки на функцию).
 *
 * Given обычный веб — хук ничего не делает с SDK (нет `window.Telegram.WebApp`) и возвращает
 * `{ shouldRenderFallback: true }` — потребитель рендерит обычную `<Button disabled={disabled}
 * loading={loading} onClick={onClick}>` (DTJ-404), используя ТЕ ЖЕ входные `disabled`/`loading`,
 * без повторного вычисления условий формы (`SRS-UX-046`, критерий приёмки 4).
 */
import { useEffect } from 'react'
import { type TranslateFunction, type TranslationKey, type TranslationParams } from '@dorutj/i18n'
import { isTwaRuntime } from './is-twa-runtime'
import { getTelegramWebApp, type TelegramMainButton } from './telegram-webapp-types'

export interface UseMainButtonOptions {
  readonly t: TranslateFunction
  readonly textKey: TranslationKey
  readonly textParams?: TranslationParams
  readonly disabled: boolean
  readonly loading: boolean
  readonly onClick: () => void
}

export interface UseMainButtonResult {
  readonly shouldRenderFallback: boolean
}

function withMainButton(callback: (mainButton: TelegramMainButton) => void): void {
  const mainButton = getTelegramWebApp()?.MainButton
  if (mainButton !== undefined) {
    callback(mainButton)
  }
}

/**
 * Вызывается на каждом рендере (дёшево: только читает `isTwaRuntime()`), но SDK-эффекты внутри
 * `useEffect` — обычные React-хуки, вызываются БЕЗУСЛОВНО (порядок хуков не зависит от среды),
 * их тело — no-op вне TWA.
 */
export function useMainButton(options: UseMainButtonOptions): UseMainButtonResult {
  const { t, textKey, textParams, disabled, loading, onClick } = options
  const text = t(textKey, textParams)
  const twa = isTwaRuntime()

  useEffect(() => {
    if (!twa) {
      return
    }
    withMainButton((mainButton) => {
      mainButton.setText(text)
      mainButton.show()
    })
    return () => {
      withMainButton((mainButton) => {
        mainButton.hide()
      })
    }
  }, [twa, text])

  useEffect(() => {
    if (!twa) {
      return
    }
    withMainButton((mainButton) => {
      if (disabled) {
        mainButton.disable()
      } else {
        mainButton.enable()
      }
    })
  }, [twa, disabled])

  useEffect(() => {
    if (!twa) {
      return
    }
    withMainButton((mainButton) => {
      if (loading) {
        mainButton.showProgress()
      } else {
        mainButton.hideProgress()
      }
    })
  }, [twa, loading])

  useEffect(() => {
    if (!twa) {
      return
    }
    withMainButton((mainButton) => {
      mainButton.onClick(onClick)
    })
    return () => {
      withMainButton((mainButton) => {
        mainButton.offClick(onClick)
      })
    }
  }, [twa, onClick])

  return { shouldRenderFallback: !twa }
}
