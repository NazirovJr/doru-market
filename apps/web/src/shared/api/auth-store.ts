import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Auth-store (EP-01, DTJ-028, SRS-UX-002, SRS-UX-014, SRS-API-035).
 *
 * Заменяет пустой стор из DTJ-003. Хранит:
 *   - `accessToken` — ТОЛЬКО в памяти (НЕ персистируется). XSS-компромисс:
 *     даже если злоумышленник прочтёт `localStorage`, у него не будет
 *     действующего access-токена; он получит только refresh и должен
 *     перехватить ВЕСЬ сетевой трафик для refresh'а (нетривиально).
 *   - `refreshToken` — `localStorage` (`zustand/persist` middleware).
 *     Гидратация: при старте приложения `http-client.refreshAccessToken()`
 *     попытается сразу сделать `POST /api/v1/auth/refresh` (SRS-API-026),
 *     если в storage найдён `refreshToken` И нет `accessToken`.
 *   - `user` — `{ id, role, phoneNumber, fullName } | null` для UI
 *     (имя в шапке, `intent`-редирект после login). ВАЖНО: `phoneNumber`
 *     для Telegram-юзеров = `null` (DTJ-027).
 *   - `setSession(...)` — единая точка обновления после login/refresh.
 *   - `clear()` — logout (удаляет ВСЁ, включая persisted refresh).
 *   - `hydrate()` — попытка refresh'а при старте; идемпотентно.
 *
 * Персистентность реализована через `zustand/persist` — Zustand сам
 * сериализует в `localStorage` и восстанавливает при загрузке модуля.
 * `partialize` исключает `accessToken` (компромисс XSS).
 */

const REFRESH_TOKEN_STORAGE_KEY = 'dorutj.auth'

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
