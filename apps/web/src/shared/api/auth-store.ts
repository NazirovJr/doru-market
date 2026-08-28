import { create } from 'zustand'

/**
 * Стор авторизации. Здесь заводится ПУСТЫМ ({ accessToken: null }) — реальный логин и
 * персистентность (refreshToken, устройство и т.д.) добавляет DTJ-024 вместе с экраном /login.
 * Отдельный от http-client файл, чтобы будущий UI (DTJ-028) мог читать/менять токен напрямую,
 * не завязываясь на слой api.
 */
interface AuthState {
  readonly accessToken: string | null
  readonly setAccessToken: (accessToken: string | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setAccessToken: (accessToken: string | null): void => {
    set({ accessToken })
  },
}))
