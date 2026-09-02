/**
 * `telegram-step.tsx` (EP-01, DTJ-028.5, SRS-UX-002/043/045/047) — кнопка
 * «Войти через Telegram» в `phone-step`.
 *
 * Контракт:
 *   - Рендерится ВСЕГДА, но `disabled=true` если `isTelegramWebApp() === false`.
 *   - `disabled` — состояние «TWA-режим недоступен, откройте страницу в
 *     Telegram Mini App», текст `auth.login.telegram_unavailable`.
 *   - На клик → `getInitData()` + `useTelegramAuth.mutate({ initData })`.
 *   - На успех → `onSuccess()` (редирект на `intent`).
 *   - На ошибку → `setErrorMessage(t('auth.login.telegram_auth_failed'))`.
 *
 * Layout: кнопка рендерится ОТДЕЛЬНОЙ строкой под `phone-step` (НЕ внутри
 * формы), чтобы submit-логика `phone-step` не перехватывала клик.
 *
 * `min-h-[48px]` (SRS-UX-002 — тап-зона ≥48×48 CSS px).
 *
 * C17: вынесен в отдельный файл, не правим `phone-step.tsx`. Композиция —
 * в `login-page.tsx` (DTJ-028).
 */
import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useTelegramAuth } from '@/features/auth/api/use-telegram-auth'
import { HttpError } from '@/shared/api/http-client'
import {
  TELEGRAM_BUTTON_MIN_HEIGHT_PX,
  getInitData,
  isTelegramWebApp,
} from '@/features/auth/lib/telegram-webapp'

export interface TelegramStepProps {
  readonly onSuccess: () => void
}

/**
 * Кнопка Telegram-signin. Рендерится в `login-page` рядом с
 * `phone-step`. Если страница открыта ВНЕ TWA (обычный браузер) —
 * `disabled` + hint «откройте в Telegram Mini App». Если внутри TWA —
 * активна, на клик вызывает `POST /api/v1/auth/telegram`.
 */
export const TelegramStep = ({ onSuccess }: TelegramStepProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const mutation = useTelegramAuth()
  const [errorMessage, setErrorMessage] = useState<string>('')
  // Detection делается ОДИН раз при монтировании: TWA-режим не меняется
  // во время жизни компонента (Telegram либо открыт, либо нет).
  // `useState` с lazy init гарантирует, что detection вызывается ровно
  // один раз и совместим с React 19 strict-mode (двойной mount в dev).
  const [twaAvailable] = useState<boolean>(() => isTelegramWebApp())

  const isSubmitting = mutation.isPending

  const handleClick = (): void => {
    if (isSubmitting || !twaAvailable) {
      return
    }
    setErrorMessage('')
    let initData: string
    try {
      initData = getInitData()
    } catch {
      // Safety net: теоретически не должно случиться, потому что
      // `twaAvailable` уже true. Но на всякий случай — `disabled`-hint.
      setErrorMessage(t('auth.login.telegram_unavailable'))
      return
    }
    mutation.mutate(
      { initData },
      {
        onSuccess: (): void => {
          onSuccess()
        },
        onError: (err): void => {
          if (err instanceof HttpError) {
            // 401 INVALID_TELEGRAM_INIT_DATA / TELEGRAM_AUTH_DATE_EXPIRED,
            // 503 SERVICE_UNAVAILABLE (telegram_bot_not_configured) — общий
            // текст ошибки без раскрытия причины (security).
            setErrorMessage(t('auth.login.telegram_auth_failed'))
          } else {
            setErrorMessage(t('ux.error.network_offline'))
          }
        },
      },
    )
  }

  // Если страница открыта ВНЕ TWA — `disabled` + hint, чтобы пользователь
  // знал, что это НЕ баг, а фича. Стили — `opacity-50` + `cursor-not-allowed`.
  const buttonClasses = twaAvailable
    ? 'rounded-md bg-[#229ED9] px-4 py-2 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-[#229ED9]'
    : 'rounded-md bg-[#229ED9] px-4 py-2 font-semibold text-white opacity-50 cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#229ED9]'

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-2" data-testid="telegram-step">
      <button
        type="button"
        onClick={handleClick}
        disabled={!twaAvailable || isSubmitting}
        className={buttonClasses}
        style={{ minHeight: TELEGRAM_BUTTON_MIN_HEIGHT_PX }}
        data-testid="telegram-button"
      >
        {isSubmitting ? `${t('auth.login.telegram_button')}…` : t('auth.login.telegram_button')}
      </button>
      {twaAvailable ? (
        <p className="text-xs text-ink-muted">{t('auth.login.telegram_hint')}</p>
      ) : (
        <p className="text-xs text-ink-muted">{t('auth.login.telegram_unavailable')}</p>
      )}
      {errorMessage.length > 0 ? (
        <p
          role="alert"
          className="text-sm text-red-600"
          data-testid="telegram-step-error"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  )
}
