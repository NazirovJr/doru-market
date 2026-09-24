/**
 * `DeliveryUnitOfWorkPort` (EP-13, DTJ-320) — 1:1 паттерн `support/application/ports/
 * support-unit-of-work.port.ts` (DTJ-279)/`payments-unit-of-work.port.ts` (DTJ-242): порт
 * модуль-локален (`02` §1.2/1.3). Нужен `EndCourierShiftUseCase` (DTJ-320, критерий DoD
 * «закрытие смены не блокируется недоступностью audit_log-сервиса» — `CourierShift.close()` +
 * `Courier.goOffShift()/settleCashOnHand()` + запись в outbox обязаны быть ОДНОЙ транзакцией)
 * и `StartCourierShiftUseCase` (`Courier.goOnShift()` + `CourierShift.start()`).
 *
 * Единственный `DeliveryUnitOfWorkTx`-маркер переиспользуется ВСЕМИ портами модуля
 * (`courier.repository.port.ts`, `delivery-assignment.repository.port.ts`,
 * `courier-shift.repository.port.ts`, `courier-rating.repository.port.ts`,
 * `delivery-outbox.port.ts`) — не заводится по одному алиасу на файл.
 */
export const DELIVERY_UNIT_OF_WORK = Symbol.for('@dorutj/delivery/unit-of-work')

export type DeliveryUnitOfWorkTx = unknown

export type DeliveryUnitOfWorkCallback<T> = (tx: DeliveryUnitOfWorkTx) => Promise<T>

export interface DeliveryUnitOfWorkPort {
  run<T>(callback: DeliveryUnitOfWorkCallback<T>): Promise<T>
}
