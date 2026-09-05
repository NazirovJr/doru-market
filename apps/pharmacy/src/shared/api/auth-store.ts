import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Auth-store (DTJ-166) — портировано из `apps/web/src/shared/api/auth-store.ts` (EP-01, DTJ-028,
 * SRS-API-035): тот же контракт `/auth/otp/*` и `/auth/refresh`, тот же компромисс хранения.
 * TODO(EP-18): вынести в общий пакет, когда появится shared auth-слой для всех фронтендов
 * (см. DTJ-166 «Риски» — переиспользование зависит от готовности `packages/ui`/shared auth к
 * волне 4; локальная копия с TODO на дедупликацию явно разрешена тикетом).
 *
 * Хранит:
 *   - `accessToken` — ТОЛЬКО в памяти (НЕ персистируется), XSS-компромисс.
 *   - `refreshToken` — `localStorage` (`zustand/persist`).
 *   - `user` — `{ id, role, tenantId, phoneNumber, fullName } | null`; `role` — источник истины
 *     для `shared/auth/auth-guard.tsx` (критерий приёмки 4 DTJ-166: `customer`/`courier`
 *     отклоняются несмотря на технически успешный OTP-verify).
 *
 * Ключ хранилища СВОЙ (`dorutj.pharmacy.auth`, не `dorutj.auth` из apps/web) — намеренно, на
 * случай совместного origin при локальной разработке/будущем path-based деплое (см. DTJ-166
 * «Технический контекст» про расхождение неймспейса маршрутов): сессии разных кабинетов не
 * обязаны делить один и тот же ключ `localStorage`.
 */

const REFRESH_TOKEN_STORAGE_KEY = 'dorutj.pharmacy.auth'

export interface AuthUser {
  readonly id: string
  readonly role: string
  readonly tenantId: string | null
  readonly phoneNumber: string | null
  readonly fullName: string | null
}

export interface AuthSession {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: AuthUser
}

export interface AuthState {
  readonly accessToken: string | null
  readonly refreshToken: string | null
  readonly user: AuthUser | null
  readonly setSession: (session: AuthSession) => void
  readonly setAccessToken: (accessToken: string | null) => void
  readonly clear: () => void
}

interface PersistedAuthSlice {
  readonly refreshToken: string | null
  readonly user: AuthUser | null
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (session): void => {
        set({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          user: session.user,
        })
      },
      setAccessToken: (accessToken): void => {
        set({ accessToken })
      },
      clear: (): void => {
        set({ accessToken: null, refreshToken: null, user: null })
      },
    }),
    {
      name: REFRESH_TOKEN_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedAuthSlice => ({
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
)
