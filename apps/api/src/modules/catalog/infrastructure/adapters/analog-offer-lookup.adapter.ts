/**
 * `NullAnalogOfferLookupAdapter` (DTJ-101, EP-07, R1) — **временная** реализация
 * `AnalogOfferLookupPort`.
 *
 * Это **явная, типизированная заглушка** (по правилу `05-DEVELOPER-HANDBOOK.md`
 * §14 «Null*Adapter + явный TODO с номером тикета»). Возвращает пустой `Map`
 * для ЛЮБОГО входа — и в продакшен-коде, и в тестах. Семантика «нет офферов»
 * для внешнего наблюдателя неотличима от семантики «офферы ещё не подключены»
 * до момента замены адаптера на реальный (см. ADR-путь ниже).
 *
 * **Почему именно NullAdapter, а не прямой SQL?**
 *
 *   Сам тикет DTJ-101 (раздел «Технический контекст») предлагает два пути:
 *
 *     (a) **прямой SQL read-моделью** через четвёртое исключение
 *         `dependency-cruiser` `no-cross-module-deep-import` — требует ADR
 *         архитектора ДО мержа (`03-ARCHITECT-DECISIONS.md` преамбула).
 *     (b) **facade-оркестрация** через `InventoryFacade`/`OnboardingFacade` —
 *         требует, чтобы эти фасады УЖЕ имели агрегатные методы
 *         `getStockAndPriceBatch`/`isVisibleAndActive`.
 *
 *   На момент реализации этого тикета:
 *     - ADR на путь (a) архитектором НЕ согласован (см. README эпика, п.3
 *       «Ключевые архитектурные решения этой зоны»);
 *     - методы для пути (b) НЕ существуют ни в `InventoryFacade`, ни
 *       в `OnboardingFacade` — добавление этих методов в чужие `files_owned`
 *       ЗАПРЕЩЕНО правилом §7 «Делай свой тикет и только его».
 *
 *   Поэтому выбран **законный третий путь**: NullAdapter с явной фиксацией
 *   в комментарии. Это согласуется с правилом §10 «Застрял — скажи, не додумывай»
 *   и §14 «Зависишь от несделанного — застабь порт null-адаптером с TODO».
 *
 * **Что остаётся как долг:** после того как `InventoryFacade` (DTJ-160..170, EP-05)
 * объявит метод `getStockAndPriceBatch`, этот файл заменяется на реальный
 * адаптер через смену DI-биндинга в `catalog.module.ts` (один `useClass: ...`).
 * Use case и контроллер НЕ меняются.
 *
 * **Безопасность заглушки.** NullAdapter возвращает пустой `Map` — это
 * консистентно с заглушкой `hasAnalogs: false` в `GetMedicineDetailUseCase`
 * (DTJ-095, файл `get-medicine-detail.use-case.ts:117`) и означает «мы пока
 * не умеем показывать аналоги», а НЕ «аналогов нет». Внешний наблюдатель
 * не сможет случайно использовать НЕреализованный движок как достоверный —
 * `FindAnalogsUseCase.items` будет всегда пустым, пока эта заглушка стоит.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011/036/061)
 * @see docs/spec/10-domain-model.md (SRS-DOM-158/159)
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.2 (долг 3.5)
 */
import { Injectable } from '@nestjs/common'
import type { PharmacyOfferPublic } from '@dorutj/contracts'
import {
  ANALOG_OFFER_LOOKUP_PORT,
  type AnalogOfferLookupInput,
  type AnalogOfferLookupPort,
} from '@/modules/catalog/application/ports/analog-offer-lookup.port.js'

/**
 * Временная реализация `AnalogOfferLookupPort`. Возвращает пустой `Map` —
 * никаких сетевых вызовов, никаких предположений о данных `inventory`.
 *
 * Возвращаемый тип — `ReadonlyMap<string, readonly PharmacyOfferPublic[]>`
 * (контракт порта). Сейчас ВСЕГДА пустой — см. JSDoc класса.
 *
 * Когда заменять (TODO ниже): после того как `InventoryFacade` (DTJ-160..170,
 * EP-05) объявит агрегатный метод `getStockAndPriceBatch(...)`, и/или после
 * согласования ADR на прямой SQL-путь. Замена — смена `useClass` в
 * `catalog.module.ts` для `ANALOG_OFFER_LOOKUP_PORT`, без правок use case.
 */
// TODO(DTJ-101→DTJ-160): заменить на реальный адаптер после появления InventoryFacade.getStockAndPriceBatch
// (EP-05, DTJ-160..170) или после согласования ADR на прямой SQL-путь (см. README ep03, п.3).
// До замены FindAnalogsUseCase возвращает items=[], savings=null для любого референса.
@Injectable()
export class NullAnalogOfferLookupAdapter implements AnalogOfferLookupPort {
  public getOffersForMedicines(
    _input: AnalogOfferLookupInput,
  ): Promise<ReadonlyMap<string, readonly PharmacyOfferPublic[]>> {
    // Заглушка — пустой `Map` мгновенно, оборачиваем в `Promise.resolve`
    // чтобы выполнить контракт порта (`Promise<...>`) без `async`-шума.
    return Promise.resolve(new Map<string, readonly PharmacyOfferPublic[]>())
  }
}

/**
 * DI-привязка (D-27): провайдер для `ANALOG_OFFER_LOOKUP_PORT`.
 * Подключается в `catalog.module.ts` добавлением одной строки в `providers`.
 */
export const ANALOG_OFFER_LOOKUP_PORT_PROVIDER = {
  provide: ANALOG_OFFER_LOOKUP_PORT,
  useClass: NullAnalogOfferLookupAdapter,
} as const