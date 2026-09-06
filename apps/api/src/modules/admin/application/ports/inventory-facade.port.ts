/**
 * DI-токен `INVENTORY_FACADE_PORT` (DTJ-350, EP-15) — сужение будущего `InventoryFacade`
 * (`@/modules/inventory`) до методов, реально нужных use case'ам `admin` (Interface
 * Segregation, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3).
 *
 * **НЕ ЗАБИНЖЕН в `admin.module.ts` (отличие от трёх соседних портов).** На момент реализации
 * этого тикета `modules/inventory` НЕ имеет публичного барабана `index.ts` вообще — ни
 * `InventoryFacade`, ни какого-либо токена наружу не экспортировано (проверено: файл
 * `apps/api/src/modules/inventory/index.ts` физически отсутствует). Реализация `InventoryFacade`
 * — ответственность `EP-05` (см. риски тикета DTJ-350: «реализация чужого фасада — НЕ входит в
 * этот тикет»). Создавать здесь весь `InventoryFacade` с нуля означало бы реализовывать логику
 * чужого модуля внутри `admin` — прямо запрещено текстом тикета.
 *
 * Токен объявлен ЗАРАНЕЕ (тот же приём, что `PAYMENTS_FACADE` в `payments/index.ts` до DTJ-249),
 * чтобы будущий тикет `admin`, которому реально понадобятся остатки, мог просто добавить
 * привязку `{ provide: INVENTORY_FACADE_PORT, useExisting: InventoryFacade }` в `admin.module.ts`
 * — ОДНОЙ строкой — как только `EP-05` экспортирует свой фасад. До этого момента любой
 * `@Inject(INVENTORY_FACADE_PORT)` в коде `admin` упадёт на резолвинге DI — это осознанно
 * (правило `05-DEVELOPER-HANDBOOK.md` §10 «застрял — скажи, не додумывай»): выдуманный фасад
 * так же недопустим, как выдуманное разрешение.
 *
 * // заполняется тикетами DTJ-351..367, ПОСЛЕ появления `modules/inventory/index.ts` (EP-05)
 */
export const INVENTORY_FACADE_PORT = Symbol.for('@dorutj/admin/inventory-facade-port')
