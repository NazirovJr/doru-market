/**
 * Порт `OnboardingFacadePort` (EP-09, DTJ-220, SRS-ORD-018 шаг 2).
 *
 * Межмодульный фасад `orders → onboarding` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2). Вызывается
 * ДЛЯ КАЖДОЙ затронутой аптеки перед сплитом корзины (SRS-ORD-018 шаг 2) — неактивная аптека
 * (`status !== 'active'`, приостановлена/на модерации/удалена) исключает свою группу целиком из
 * ПОПЫТКИ checkout (`meta.excludedItems`, причина `PHARMACY_SUSPENDED`), аналогично
 * Rx-исключению (SRS-ORD-015).
 *
 * Реализация — адаптер поверх публичного фасада `modules/onboarding/index.ts`, заводится
 * потребляющим тикетом (`CheckoutUseCase`, DTJ-227). Здесь — ТОЛЬКО контракт (DTJ-220,
 * скаффолдинг).
 *
 * РАСШИРЕНИЕ (DTJ-225, доработка по замечанию CTO): `getPharmacyNames` добавлен этим тикетом.
 * `GetCartUseCase`/`SplitCartByPharmacyUseCase` обязаны показывать пользователю ОТОБРАЖАЕМОЕ
 * имя аптеки в `meta.pharmacyGroups`/`items[].pharmacyName` (SRS-ORD-002) — ни `CatalogFacadePort`,
 * ни `InventoryFacadePort` этого не несут, `pharmacies.name` — зона `onboarding`
 * (`modules/onboarding/onboarding.facade.ts`). Батч, а не по одному — тот же приём, что
 * `getMedicineSnapshot`/`getSubstanceSet` (`CatalogFacadePort`): один вызов на ВСЕ уникальные
 * `pharmacyId` корзины, не N+1 на каждую группу.
 */

/** DI-токен для провайдера `OnboardingFacadePort`. */
export const ONBOARDING_FACADE_PORT = Symbol.for('@dorutj/orders/onboarding-facade')

export interface OnboardingFacadePort {
  /** `true`, если аптека в статусе `active` — единственный статус, допускающий приём заказов. */
  isPharmacyActive(pharmacyId: string): Promise<boolean>

  /**
   * Батч-снимок отображаемых имён аптек по id (DTJ-225, SRS-ORD-002). Несуществующая/удалённая
   * аптека молча пропускается в возвращаемой `Map` — вызывающий (`GetCartUseCase`) трактует
   * отсутствие в `Map` как «имя неизвестно» (`pharmacyName: null`), НЕ как ошибку и НЕ
   * подставляет `pharmacyId` вместо имени (правдоподобные фальшивые данные в ответе
   * пользователю запрещены — см. отчёт сдачи DTJ-225).
   */
  getPharmacyNames(pharmacyIds: readonly string[]): Promise<ReadonlyMap<string, string>>
}
