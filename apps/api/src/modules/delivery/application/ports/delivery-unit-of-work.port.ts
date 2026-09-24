export const DELIVERY_UNIT_OF_WORK = Symbol.for('@dorutj/delivery/unit-of-work')

export type DeliveryUnitOfWorkTx = unknown

export type DeliveryUnitOfWorkCallback<T> = (tx: DeliveryUnitOfWorkTx) => Promise<T>

export interface DeliveryUnitOfWorkPort {
  run<T>(callback: DeliveryUnitOfWorkCallback<T>): Promise<T>
}
