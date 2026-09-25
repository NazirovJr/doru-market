/**
 * `decodeRoleFromAccessToken` (DTJ-350, EP-15) — читает claim `role` из JWT access-токена БЕЗ
 * проверки подписи: клиентское декодирование служит ТОЛЬКО построению дерева маршрутов/меню
 * (UX) — реальная авторизация остаётся на бэкенде (`@Roles(...)` гварды, `AuthGuard`/`RolesGuard`
 * EP-01, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1). Подделанный на клиенте токен не даёт доступа
 * ни к одному реальному эндпоинту — только к пустому/неверному экрану, что не является дырой
 * безопасности.
 *
 * Токен целиком (не факт его хранения) передаётся параметром — функция намеренно ЧИСТАЯ, без
 * обращения к `localStorage` изнутри, чтобы быть тестируемой без моков storage. Источник самого
 * токена (`ACCESS_TOKEN_STORAGE_KEY` ниже) — ВРЕМЕННОЕ решение до тикета, реализующего реальный
 * вход в `apps/admin` (по аналогии с `apps/pharmacy` `DTJ-166`, `dorutj.pharmacy.auth`): этот
 * тикет (DTJ-350) не строит форму логина/OTP-флоу, только каркас роутинга по роли.
 *
 * Невалидный/отсутствующий токен, неразбираемый payload, отсутствующий или нераспознанный
 * `role` — везде `null` (безопасный дефолт: ни один ролевой раздел не монтируется, критерий
 * приёмки 3 DTJ-350), не throw — вызывающий код (`router.tsx`) не обязан оборачивать в try/catch.
 */
import { USER_ROLES, type UserRole } from '@dorutj/contracts'

/** Ключ `localStorage` для access-токена `apps/admin` — см. JSDoc файла про временность. */
export const ACCESS_TOKEN_STORAGE_KEY = 'dorutj.admin.access_token'

/** Base64 работает блоками по 4 символа — паддинг `=` дополняет остаток до кратного (C6, без магических чисел). */
const BASE64_BLOCK_SIZE = 4
/** JWT — 3 сегмента, разделённых `.` (header/payload/signature). */
const JWT_SEGMENT_COUNT = 3

function base64UrlToBase64(segment: string): string {
  const withStdAlphabet = segment.replaceAll('-', '+').replaceAll('_', '/')
  const paddingNeeded = (BASE64_BLOCK_SIZE - (withStdAlphabet.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE
  return withStdAlphabet + '='.repeat(paddingNeeded)
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  const payloadSegment = parts[1]
  if (parts.length !== JWT_SEGMENT_COUNT || payloadSegment === undefined) {
    return null
  }
  try {
    const json = atob(base64UrlToBase64(payloadSegment))
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/** Given raw JWT (или `null`, если сессии нет), возвращает распознанную роль или `null`. */
export function decodeRoleFromAccessToken(token: string | null): UserRole | null {
  if (token === null || token.length === 0) {
    return null
  }
  const payload = decodeJwtPayload(token)
  const role = payload?.role
  return isUserRole(role) ? role : null
}

/** Читает токен из `localStorage` и декодирует роль — обёртка для `router.tsx` (module scope). */
export function getCurrentRole(): UserRole | null {
  try {
    return decodeRoleFromAccessToken(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY))
  } catch {
    // `localStorage` недоступен (приватный режим/SSR) — тот же безопасный дефолт.
    return null
  }
}

/** DTJ-381 — воронка аналитики требует tenantId в query; тот же приём decode, что и роль выше. */
export function decodeTenantIdFromAccessToken(token: string | null): string | null {
  if (token === null || token.length === 0) {
    return null
  }
  const tenantId = decodeJwtPayload(token)?.tenantId
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null
}

/** Читает токен из `localStorage` и декодирует tenantId — обёртка для `funnel-page.tsx` (DTJ-381). */
export function getCurrentTenantId(): string | null {
  try {
    return decodeTenantIdFromAccessToken(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY))
  } catch {
    return null
  }
}
