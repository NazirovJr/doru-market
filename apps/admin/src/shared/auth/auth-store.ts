import { useSyncExternalStore } from 'react'
import { ACCESS_TOKEN_STORAGE_KEY } from './current-role'

// Без zustand (не в package.json apps/admin, files_owned DTJ-434 разрешает добавить в package.json
// только @dorutj/ui) — тот же публичный контракт (getState/setState/selector-хук), что у
// apps/pharmacy/src/shared/api/auth-store.ts, на useSyncExternalStore.
const SESSION_STORAGE_KEY = 'dorutj.admin.auth'

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

type AuthData = Pick<AuthState, 'accessToken' | 'refreshToken' | 'user'>

function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { id?: unknown; role?: unknown }
  return typeof candidate.id === 'string' && typeof candidate.role === 'string'
}

function readPersisted(): Pick<AuthData, 'refreshToken' | 'user'> {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (raw === null) {
      return { refreshToken: null, user: null }
    }
    const parsed = JSON.parse(raw) as { refreshToken?: unknown; user?: unknown }
    return {
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      user: isAuthUser(parsed.user) ? parsed.user : null,
    }
  } catch {
    return { refreshToken: null, user: null }
  }
}

function persist(refreshToken: string | null, user: AuthUser | null): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ refreshToken, user }))
  } catch {
    // best-effort (приватный режим/квота) — сессия остаётся в памяти на текущую вкладку
  }
}

// current-role.ts (DTJ-350) синхронно читает роль/tenantId/chainId из ACCESS_TOKEN_STORAGE_KEY —
// зеркалируем accessToken туда же при каждом изменении, не трогая контракт того файла.
function mirrorAccessToken(token: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
    } else {
      localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token)
    }
  } catch {
    // best-effort
  }
}

let data: AuthData = { accessToken: null, ...readPersisted() }
// useSyncExternalStore требует стабильную ссылку на снапшот между изменениями — пересобираем
// объект состояния только в notify(), не на каждый вызов getState()/селектора.
let cachedState: AuthState = buildState()
const listeners = new Set<() => void>()

function buildState(): AuthState {
  return { ...data, setSession, setAccessToken, clear }
}

// Оповещение подписчиков (AppRouter пересобирает дерево по роли) отложено в макротаск: иначе
// пересборка рвёт синхронно ещё выполняющийся onSuccess мутации логина (найдено живой проверкой).
// getState() обновляется сразу, отложено только уведомление React о ре-рендере.
let broadcastScheduled = false

function broadcast(): void {
  broadcastScheduled = false
  listeners.forEach((listener) => {
    listener()
  })
}

function notify(): void {
  cachedState = buildState()
  if (!broadcastScheduled) {
    broadcastScheduled = true
    setTimeout(broadcast, 0)
  }
}

function setSession(session: AuthSession): void {
  data = { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user }
  mirrorAccessToken(session.accessToken)
  persist(session.refreshToken, session.user)
  notify()
}

function setAccessToken(accessToken: string | null): void {
  data = { ...data, accessToken }
  mirrorAccessToken(accessToken)
  notify()
}

function clear(): void {
  data = { accessToken: null, refreshToken: null, user: null }
  mirrorAccessToken(null)
  persist(null, null)
  notify()
}

function getState(): AuthState {
  return cachedState
}

/** Тестовый хелпер — та же роль, что `useAuthStore.setState` в zustand-версии (apps/pharmacy). */
function setState(partial: Partial<AuthData>): void {
  data = { ...data, ...partial }
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useAuthStoreHook<T>(selector: (state: AuthState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(cachedState))
}

export const useAuthStore = Object.assign(useAuthStoreHook, { getState, setState })
