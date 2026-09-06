/**
 * Порт `ReturnsRepositoryPort` (EP-11, DTJ-273, SRS-DOM-052/056). Единственный способ, которым
 * use case'ы этого модуля читают/пишут агрегат `OrderReturn` — БД хранит ТЕКУЩЕЕ состояние в
 * одной строке `order_returns` (история переходов — `audit_log`, не версионирование строки).
 *
 * `findActiveByOrderId` возвращает ID возвратов НЕ в терминальном статусе (всё, кроме
 * `return_confirmed` — `return_rejected` не терминален, SRS-DOM-056, остаётся «активным» для
 * целей дубликат-проверки) — форма 1:1 с `OrderReturnRequestCommand.existingNonTerminalReturnIds`
 * (`domain/order-return.entity.ts`), чтобы use case не делал лишний маппинг.
 */
import type { OrderReturn } from '../../domain/index.js'
import type { ReturnsUnitOfWorkTx } from './orders-facade.port.js'

export const RETURNS_REPOSITORY = Symbol.for('@dorutj/returns/repository')

export interface ReturnsRepositoryPort {
  findById(id: string, tx?: ReturnsUnitOfWorkTx): Promise<OrderReturn | null>
  findActiveByOrderId(orderId: string, tx?: ReturnsUnitOfWorkTx): Promise<readonly string[]>
  save(orderReturn: OrderReturn, tx?: ReturnsUnitOfWorkTx): Promise<void>
}
