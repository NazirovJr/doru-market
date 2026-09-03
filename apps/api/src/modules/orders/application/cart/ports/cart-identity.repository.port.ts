/**
 * `CartIdentityRepository` (EP-09, DTJ-226, D-EP09-22/D-EP09-23) — резолвинг и идемпотентное
 * создание строки `cart` по владельцу (`customerId`/`sessionToken`). НЕ операции над
 * `cart_items` — те остаются в `CartRepository` (DTJ-223, `cart.repository.port.ts`).
 *
 * Отдельный порт, а не расширение `CartRepository`, по двум причинам:
 *   1. Interface segregation — `CartRepository` целиком про операции НАД уже известным
 *      `cartId`; резолвинг владения — другая ответственность (создание корзины из HTTP-слоя,
 *      которого DTJ-223/224/225 не знали — они принимали готовый `cartId`).
 *   2. `cart.repository.port.ts`/`cart.repository.ts`/`in-memory-cart-repository.fixture.ts` —
 *      файлы DTJ-223, уже принятые CTO; параллельно с этим тикетом в той же кодовой базе идёт
 *      DTJ-227, и расширение чужого интерфейса ровно в это окно — лишний риск конфликта без
 *      необходимости, когда самостоятельный порт даёт тот же результат с нулевым пересечением.
 *
 * **D-EP09-22** (решение CTO, `reports/EP09-CTO-BRIEF.md`): ни один use case DTJ-223..225 не
 * создаёт строку `cart` — до этого тикета её создавали только тестовые фикстуры. Первый живой
 * `POST /api/v1/cart/items` падал бы на `NotFoundError: cart`. `findOrCreate*` — идемпотентно:
 * гонка двух одновременных `POST` ОТ ОДНОГО клиента (тот же `customerId`/`sessionToken`) даёт
 * РОВНО одну строку `cart`, не две (advisory-lock в `DrizzleCartIdentityRepository`, JSDoc там).
 *
 * **D-EP09-23**: гостевой `session_token` — bearer-секрет, генерируется СЕРВЕРОМ
 * (`node:crypto`, `ResolveOrCreateCartUseCase`), никогда клиентом. Этот порт только
 * резолвит/создаёт запись по уже готовому значению — не решает, откуда оно взялось, и не
 * валидирует его формат (это ответственность presentation/application выше).
 *
 * Тенант-изоляция — тот же контракт, что `CartRepository` (SRS-API-043/046): `tenantId` —
 * ПЕРВЫЙ параметр каждого метода, не опционален. Чужой тенант ⇒ `null`/`false`, никогда throw.
 */
import type { CartRecord } from './cart.repository.port.js'

/** DI-токен для провайдера `CartIdentityRepository`. */
export const CART_IDENTITY_REPOSITORY = Symbol.for('@dorutj/orders/cart-identity-repository')

export interface CartIdentityRepository {
  /** Read-only, БЕЗ создания. Используется `MergeGuestCartUseCase` — «есть ли уже своя корзина». */
  findByCustomerId(tenantId: string, customerId: string): Promise<CartRecord | null>

  /** Read-only, БЕЗ создания. Используется `MergeGuestCartUseCase` — резолв гостевой корзины. */
  findBySessionToken(tenantId: string, sessionToken: string): Promise<CartRecord | null>

  /**
   * Возвращает существующую корзину клиента, либо атомарно создаёт ровно одну, если её ещё
   * нет (D-EP09-22 — конкурентные вызовы с ОДНИМ `customerId` не должны создать две строки).
   */
  findOrCreateByCustomerId(tenantId: string, customerId: string): Promise<CartRecord>

  /** Та же гарантия идемпотентности, что `findOrCreateByCustomerId`, по ключу `sessionToken`. */
  findOrCreateBySessionToken(tenantId: string, sessionToken: string): Promise<CartRecord>

  /**
   * `MergeGuestCartUseCase`, ветка «у клиента ещё нет своей корзины» (SRS-ORD-020 «Что
   * сделать» §5): `UPDATE cart SET customer_id=…, session_token=NULL` — гостевая строка
   * ПЕРЕПРИВЯЗЫВАЕТСЯ, `cart_items` не трогаются (id корзины не меняется). `null`, если строка
   * не найдена/принадлежит другому тенанту.
   */
  rebindToCustomer(tenantId: string, cartId: string, customerId: string): Promise<CartRecord | null>

  /**
   * `MergeGuestCartUseCase`, ветка «у клиента УЖЕ есть своя корзина»: гостевая строка `cart`
   * удаляется ПОСЛЕ построчного переноса позиций (`cart_items` каскадно уходят вместе с ней,
   * `ON DELETE CASCADE`, `0023_orders_cart.sql`) — не остаётся сиротой.
   */
  deleteCart(tenantId: string, cartId: string): Promise<boolean>
}
