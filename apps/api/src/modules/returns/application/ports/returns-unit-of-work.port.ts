/**
 * Порт `ReturnsUnitOfWorkPort` (EP-11, DTJ-273). Файл СВЕРХ буквального `files_owned` DTJ-273
 * (тот же приём, что `support/application/ports/support-unit-of-work.port.ts` DTJ-279 — правило
 * 11 AGENTS.md) — use case'ы этого тикета не могут выполнить критерий приёмки «`outbox`-события
 * публикуются в ТОЙ ЖЕ транзакции, что изменение `order_returns`» без единицы работы. Реиспользует
 * `ReturnsUnitOfWorkTx` из `orders-facade.port.ts` (DTJ-270) — тот же дескриптор транзакции, что
 * уже приняли все 4 межмодульных порта этого модуля, не заводит второй параллельный тип.
 */
import type { ReturnsUnitOfWorkTx } from './orders-facade.port.js'

export const RETURNS_UNIT_OF_WORK = Symbol.for('@dorutj/returns/unit-of-work')

export type ReturnsUnitOfWorkCallback<T> = (tx: ReturnsUnitOfWorkTx) => Promise<T>

export interface ReturnsUnitOfWorkPort {
  run<T>(callback: ReturnsUnitOfWorkCallback<T>): Promise<T>
}
