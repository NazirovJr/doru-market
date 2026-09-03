import type {
  CartDuplicateSubstanceWarningDto,
  CartInsufficientStockWarningDto,
  CartItemResponseDto,
  CartPharmacyGroupDto,
  CartViewMetaDto,
  CartViewResponseDto,
} from '@dorutj/contracts'
import {
  httpRequest,
  HttpError,
  requestJsonEnvelope,
  type JsonEnvelopeResult,
  type JsonMeta,
} from '@/shared/api/http-client'
import { useAuthStore } from '@/shared/api/auth-store'
import { useCartSessionStore } from '../model/cart-session-store'

/**
 * `cart.api.ts` (DTJ-234, EP-09) — единственная точка входа в сеть для `GET/POST/PATCH/DELETE
 * /api/v1/cart*` (бэкенд DTJ-226, `cart.controller.ts`, прочитан целиком для этого тикета).
 *
 * Заголовок `X-Cart-Session-Token` (тикет DTJ-234, «Идентификация корзины») обрабатывается ЗДЕСЬ,
 * а не в `shared/api/http-client.ts` — та же граница ответственности, что `buildHeaders`
 * (Authorization) в самом `http-client.ts`: протокол корзины специфичен ОДНОМУ фиче, остальные
 * фичи о нём не знают.
 *   - Запрос: заголовок прикладывается ТОЛЬКО когда нет `accessToken` (гость) — правило 5 тикета,
 *     «не слать оба» (`buildCartRequestHeaders`).
 *   - Ответ: `X-Cart-Session-Token` читается из ЛЮБОГО ответа (успех/бизнес-ошибка) ДО того, как
 *     `requestJsonEnvelope` бросит `HttpError` — сервер ставит заголовок ДО возможного throw
 *     (`applyIssuedSessionToken` в контроллере вызывается до `throw result.error`), поэтому
 *     капча токена идёт через `onResponse`-хук `requestJsonEnvelope` (DTJ-234 добавил его в
 *     `http-client.ts` ИМЕННО для этого случая — см. JSDoc там). Новый токен ВСЕГДА перезаписывает
 *     старый (`useCartSessionStore.setToken`, защита от session fixation, п.2 правил тикета).
 *
 * `CartItemRecordDto`/`UpdateCartItemQuantityResponse` НЕ описаны в `@dorutj/contracts` (та же
 * ситуация, что `search.api.ts`, DTJ-192, JSDoc там) — `POST`/`PATCH /cart/items*` возвращают
 * ОБЛЕГЧЁННУЮ форму строки корзины (`CartItemRecordResponseDto`, presentation-локальный тип
 * `apps/api/.../cart/cart-view.mapper.ts`, НЕ экспортирован в пакет контрактов), отличную от
 * `CartItemResponseDto` (с живой ценой/остатком, отдаётся только `GET /cart`) — списано построчно
 * с мaппера, не придумано.
 */

const CART_SESSION_TOKEN_HEADER = 'x-cart-session-token'
const CART_PATH = '/api/v1/cart'
const CART_ITEMS_PATH = '/api/v1/cart/items'
const HTTP_STATUS_NO_CONTENT = 204

export interface CartView {
  readonly items: readonly CartItemResponseDto[]
  readonly pharmacyGroups: readonly CartPharmacyGroupDto[]
  readonly warnings: readonly CartInsufficientStockWarningDto[]
}

/** См. JSDoc файла — форма `POST/PATCH /cart/items*`, списана с `CartItemRecordResponseDto`. */
export interface CartItemRecordDto {
  readonly id: string
  readonly cartId: string
  readonly medicineId: string
  readonly pharmacyId: string
  readonly quantity: number
  readonly addedAt: string
}

export interface AddCartItemInput {
  readonly medicineId: string
  readonly pharmacyId: string
  readonly quantity: number
}

export interface AddCartItemResult {
  readonly item: CartItemRecordDto
  readonly warnings: readonly CartDuplicateSubstanceWarningDto[]
}

export type UpdateCartItemQuantityResult =
  { readonly kind: 'removed' } | { readonly kind: 'updated'; readonly item: CartItemRecordDto }

function buildCartRequestHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  // Правило 5 тикета: аутентифицированный пользователь резолвится по Bearer JWT
  // (`buildHeaders` в `http-client.ts` уже прикладывает `Authorization` сам) — заголовок сессии
  // корзины в этом случае НЕ шлём, гостевой токен становится неактуален после логина.
  const isAuthenticated = useAuthStore.getState().accessToken !== null
  if (isAuthenticated) {
    return headers
  }
  const sessionToken = useCartSessionStore.getState().sessionToken
  if (sessionToken !== null) {
    headers.set(CART_SESSION_TOKEN_HEADER, sessionToken)
  }
  return headers
}

function captureIssuedSessionToken(response: Response): void {
  const issued = response.headers.get(CART_SESSION_TOKEN_HEADER)
  if (issued !== null && issued.length > 0) {
    useCartSessionStore.getState().setToken(issued)
  }
}

function requestCartEnvelope<T>(path: string, init: RequestInit = {}): Promise<JsonEnvelopeResult<T>> {
  return requestJsonEnvelope<T>(
    path,
    { ...init, headers: buildCartRequestHeaders(init.headers) },
    captureIssuedSessionToken,
  )
}

function buildCartPath(extendHold: boolean): string {
  return extendHold ? `${CART_PATH}?extendHold=true` : CART_PATH
}

/** `meta` — непрозрачный `JsonMeta` на уровне `shared/api` (см. его JSDoc) — распаковывается по
 *  месту, тот же приём, что `readPagination` в `search-results.api.ts`: лёгкая проверка формы
 *  (массив ли поле), не полная валидация каждого вложенного DTO — сервер уже гарантирует форму
 *  контрактом, здесь только защита от `undefined`/мусора, не повторная валидация ответа. */
function isJsonArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function readCartViewMeta(meta: JsonMeta | undefined): Pick<CartViewMetaDto, 'pharmacyGroups' | 'warnings'> {
  const pharmacyGroups = meta?.pharmacyGroups
  const warnings = meta?.warnings
  return {
    pharmacyGroups: isJsonArray(pharmacyGroups) ? (pharmacyGroups as readonly CartPharmacyGroupDto[]) : [],
    warnings: isJsonArray(warnings) ? (warnings as readonly CartInsufficientStockWarningDto[]) : [],
  }
}

/** `extendHold` — SRS-ORD-005 UX-эффект: продлевает мягкий холд остатка ДО сборки ответа. Флаг
 *  экрана (CartScreen шлёт `true` при открытии), не часть идентичности запроса — вызывающий
 *  код сам решает, когда он нужен. */
export async function fetchCart(extendHold: boolean): Promise<CartView> {
  const envelope = await requestCartEnvelope<CartViewResponseDto>(buildCartPath(extendHold))
  const meta = readCartViewMeta(envelope.meta)
  return { items: envelope.data.items, pharmacyGroups: meta.pharmacyGroups, warnings: meta.warnings }
}

export async function addCartItem(input: AddCartItemInput): Promise<AddCartItemResult> {
  const envelope = await requestCartEnvelope<CartItemRecordDto>(CART_ITEMS_PATH, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  const warnings = envelope.meta?.warnings
  return {
    item: envelope.data,
    warnings: isJsonArray(warnings) ? (warnings as readonly CartDuplicateSubstanceWarningDto[]) : [],
  }
}

export async function updateCartItemQuantity(
  cartItemId: string,
  quantity: number,
): Promise<UpdateCartItemQuantityResult> {
  const envelope = await requestCartEnvelope<CartItemRecordDto | { readonly removed: true }>(
    `${CART_ITEMS_PATH}/${cartItemId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    },
  )
  if ('removed' in envelope.data) {
    return { kind: 'removed' }
  }
  return { kind: 'updated', item: envelope.data }
}

/**
 * `DELETE /cart/items/:id` — 204 БЕЗУСЛОВНО, идемпотентно (см. JSDoc `cart.api.ts` файла и
 * бэкенд-контроллер). Не проходит через `requestCartEnvelope`/`requestJsonEnvelope` — та функция
 * ожидает JSON-тело в успешной ветке (`isSuccessEnvelope`), а 204 по HTTP-спецификации тела не
 * несёт; успех здесь определяется статусом, не разбором тела.
 */
export async function removeCartItem(cartItemId: string): Promise<void> {
  const response = await httpRequest(`${CART_ITEMS_PATH}/${cartItemId}`, {
    method: 'DELETE',
    headers: buildCartRequestHeaders(),
  })
  captureIssuedSessionToken(response)
  if (response.status !== HTTP_STATUS_NO_CONTENT) {
    throw new HttpError(response.status, 'UNKNOWN_ERROR', {
      message: `Unexpected response from DELETE ${CART_ITEMS_PATH}/${cartItemId} (status=${String(response.status)})`,
    })
  }
}
