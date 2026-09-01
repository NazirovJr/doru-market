/**
 * `use-telegram-auth.ts` (EP-01, DTJ-028.5, SRS-API-031) — TanStack Query
 * мутация поверх `httpPostJson('/api/v1/auth/telegram', ...)`.
 *
 * Контракт (бэкенд DTJ-027, TelegramAuthController):
 *   - input:  `{ initData: string }` — сырая `window.Telegram.WebApp.initData`
 *   - 200:    `{ data: { accessToken, refreshToken, user: { id, role, tenantId,
 *             phoneNumber: null, fullName }, telegram: { telegramUserId,
 *             firstName, lastName, username } } }`
 *   - 401:    `INVALID_TELEGRAM_INIT_DATA`, `TELEGRAM_AUTH_DATE_EXPIRED`
 *   - 503:    `SERVICE_UNAVAILABLE` (reason: `telegram_bot_not_configured`)
 *
 * На УСПЕХЕ вызывает `useAuthStore.setSession({ accessToken, refreshToken, user })`
 * — refresh персистится в `localStorage` (DTJ-028).
 *
 * `phoneNumber` от Telegram-пути ВСЕГДА `null` (до запроса phone на
 * оформлении заказа, см. R1-9 Catalog). Это часть контракта API.
 *
 * БЕЗ ретраев (`retry: 0`): initData всегда свежий, повторять бессмысленно.
 * `mutationKey: ['auth', 'telegram']` — отличие от OTP-мутаций.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { useAuthStore, type AuthSession } from '@/shared/api/auth-store'

interface TelegramAuthRequest {
  readonly initData: string
}

interface TelegramAuthResponse {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: {
    readonly id: string
    readonly role: string
    readonly tenantId: string | null
    /**
     * Telegram-путь ВСЕГДА возвращает `phoneNumber: null` (DTJ-027, SRS-API-031).
     * Клиент НЕ должен ожидать непустого значения.
     */
    readonly phoneNumber: string | null
    readonly fullName: string | null
  }
  readonly telegram: {
    readonly telegramUserId: string
    readonly firstName: string
    readonly lastName: string | null
    readonly username: string | null
  }
}

export function useTelegramAuth(): UseMutationResult<
  TelegramAuthResponse,
  HttpError,
  TelegramAuthRequest
> {
  return useMutation<TelegramAuthResponse, HttpError, TelegramAuthRequest>({
    mutationKey: ['auth', 'telegram'],
    retry: 0,
    mutationFn: async (input: TelegramAuthRequest): Promise<TelegramAuthResponse> => {
      const response = await httpPostJson<TelegramAuthResponse>('/api/v1/auth/telegram', input)
      const session: AuthSession = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        user: response.user,
      }
      useAuthStore.getState().setSession(session)
      return response
    },
  })
}
