/**
 * Порт `CartRepository` (EP-09, DTJ-223; тенант-изоляция — доработка по замечанию CTO,
 * SRS-API-043/046).
 *
 * Тонкий адаптер над `cart`/`cart_items` (таблицы созданы в DTJ-220,
 * `apps/api/src/db/schema/cart.ts`). Cart — НЕ доменный агрегат (`tickets/00-EPICS.md`,
 * комментарий к таблице `cart` в `10-domain-model.md`), поэтому порт оперирует простыми
 * DTO-записями (`CartRecord`/`CartItemRecord`), не доменными сущностями.
 *
 * `application` не знает об `infrastructure`/`db` (`.dependency-cruiser.cjs`
 * `application-does-not-know-infrastructure`/`no-db-schema-in-business-layers`) — реализация
 * (Drizzle) в `infrastructure/repositories/cart.repository.ts`.
 *
 * Даты — `Date`, не ISO-строки: это внутренний application-контракт, не JSON-граница.
 * Wire-формат (`CartItemDto`, `@dorutj/contracts/orders.ts`, ISO-строки) собирает
 * presentation-слой (DTJ-226) из этих записей — не наоборот.
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043, обязательное правило проекта, НЕ опция этого тикета):
 * `tenantId` — ПЕРВЫЙ явный параметр КАЖДОГО метода, не читается неявно из
 * `AsyncLocalStorage`/`TenantContext` внутри репозитория или use case'а — источник значения
 * (сейчас — только сигнатура use case'а; presentation, DTJ-226, прокинет `TenantContext`).
 * Параметр НЕ опционален специально: вызов без него — ошибка компиляции TS, а не забытый
 * рантайм-фильтр (SRS-API-043 требует именно этого, статический анализ `WHERE tenant_id=`
 * в SQL не проверяет). `cart_items` СВОЕЙ колонки `tenant_id` не несёт (см. DDL DTJ-220) —
 * скоуп обеспечивается ЕДИНСТВЕННО через `cart_id`, принадлежащий тенантной `cart`; каждый
 * метод, трогающий `cart_items`, обязан провести эту проверку АТОМАРНО в одном SQL-операторе
 * (без окна между проверкой и записью — гонка удаления/переноса корзины между двумя round-trip
 * иначе давала бы утечку записи в чужой тенант). Реализация — `DrizzleCartRepository`, JSDoc
 * там же расписывает конкретный SQL на метод.
 *
 * Чужой тенант ⇒ `null`/`false`/пустой массив — НЕ исключение, НЕ `Forbidden`: SRS-API-046
 * требует `404 NOT_FOUND` (сущность чужого тенанта не подтверждается как существующая),
 * use case конвертирует в `NotFoundError`.
 */

/** DI-токен для провайдера `CartRepository`. */
export const CART_REPOSITORY = Symbol.for('@dorutj/orders/cart-repository')

export interface CartRecord {
  readonly id: string
  readonly tenantId: string
  readonly customerId: string | null
  readonly sessionToken: string | null
}

export interface CartItemRecord {
  readonly id: string
  readonly cartId: string
  readonly medicineId: string
  readonly pharmacyId: string
  readonly quantity: number
  readonly addedAt: Date
}

export interface UpsertCartItemInput {
  readonly cartId: string
  readonly medicineId: string
  readonly pharmacyId: string
  /**
   * Прибавляется к существующему `quantity` строки при конфликте на
   * `unique_cart_medicine_pharmacy`, а не заменяет его (DTJ-223 критерий приёмки №1:
   * `AddCartItemUseCase` дважды с одним `(medicineId, pharmacyId)` даёт ОДНУ строку с суммой).
   */
  readonly quantityDelta: number
}

/** Объект-параметр `updateItemQuantity`, не 4 позиционных (C5, `max-params` ≤3). */
export interface UpdateCartItemQuantityRepoInput {
  readonly tenantId: string
  readonly cartId: string
  readonly cartItemId: string
  readonly quantity: number
}

export interface CartRepository {
  findById(tenantId: string, cartId: string): Promise<CartRecord | null>

  findItemsByCartId(tenantId: string, cartId: string): Promise<readonly CartItemRecord[]>

  /**
   * РАСШИРЕНИЕ (DTJ-227, тот же приём аддитивного расширения существующего порта, что
   * `getPharmacyNames`/`getStockQuantity`, D-EP09-9/D-EP09-16 — не изобретение нового
   * механизма, правило 12 AGENTS.md). `CheckoutCommand.cartItemIds[]` адресует КОНКРЕТНЫЕ
   * строки `cart_items` напрямую (клиент может оформить лишь ПОДмножество корзины) — без
   * этого метода `CheckoutUseCase` не может загрузить их одним батч-запросом, только по одной
   * (`cart_items` не несёт `tenant_id`, скоуп — ЕДИНСТВЕННО через родительскую `cart`).
   *
   * Тенант-скоуп (SRS-API-043): возвращает только строки, чья `cart` принадлежит `tenantId`.
   * Строки чужого тенанта/несуществующие id — молча отсутствуют в результате (SRS-API-046,
   * тот же приём, что `getMedicineSnapshot`) — CheckoutUseCase решает, что делать с
   * недостающими id (см. `ForbiddenError`/несовпадение count).
   */
  findItemsByIds(tenantId: string, cartItemIds: readonly string[]): Promise<readonly CartItemRecord[]>

  /**
   * `INSERT ... SELECT ... FROM cart WHERE cart.id=:cartId AND cart.tenant_id=:tenantId
   * ON CONFLICT (cart_id, medicine_id, pharmacy_id) DO UPDATE SET quantity =
   * cart_items.quantity + excluded.quantity` — упсёрт, НЕ голый `UPDATE` (урок волны 5,
   * `reports/EP09-CTO-BRIEF.md` §6.6: голый `UPDATE` матчит 0 строк на первой вставке и молча
   * теряет данные при заявленном успехе). `INSERT ... SELECT` (не `INSERT ... VALUES`) —
   * тенант-фильтр внутри ОДНОГО атомарного оператора: чужой `tenantId` ⇒ подзапрос даёт 0
   * строк ⇒ вставляется 0 строк ⇒ `null`, без отдельного round-trip'а на проверку владения.
   */
  upsertItem(tenantId: string, input: UpsertCartItemInput): Promise<CartItemRecord | null>

  /**
   * Скоуп по `cartId` И `tenantId` — владение корзиной проверяется на уровне репозитория
   * (DTJ-223 «Что сделать» §2/§3 + SRS-API-043/046). `null`, если строка не найдена, либо
   * принадлежит другой корзине, либо корзина принадлежит другому тенанту.
   */
  updateItemQuantity(input: UpdateCartItemQuantityRepoInput): Promise<CartItemRecord | null>

  /** Возвращает `true`, если строка была удалена (найдена, принадлежала `cartId` этого `tenantId`). */
  deleteItem(tenantId: string, cartId: string, cartItemId: string): Promise<boolean>
}
