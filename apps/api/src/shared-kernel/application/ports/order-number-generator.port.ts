/**
 * `OrderNumberGeneratorPort` (EP-01, DTJ-011, SRS-DOM-085) — порт
 * генерации человекочитаемых `OrderNumber`.
 *
 * Принимает уже вычисленную `dateYYMMDD` (в `Asia/Dushanbe`); сам порт
 * НЕ читает время и НЕ знает о таймзонах. Вызывающий код получает
 * `dateYYMMDD` через `ClockPort.nowInTenantTz(...)` (DTJ-006), адаптер
 * оркестрирует Redis-счётчик по переданному ключу.
 *
 * При недоступности Redis адаптер ОБЯЗАН пробросить ошибку как есть
 * (SRS-DB-048), не проглатывать и не откатываться на `Math.random()`.
 */
import { type OrderNumber } from '@/shared-kernel/domain/value-objects/order-number.vo.js'

export const ORDER_NUMBER_GENERATOR = Symbol.for('@dorutj/shared-kernel/order-number-generator')

export interface OrderNumberGeneratorPort {
  /**
   * Генерирует следующий `OrderNumber` для календарной даты `dateYYMMDD`
   * (`'YYMMDD'`, например `'260827'`). На проде — через `INCR order_seq:{dateYYMMDD}` +
   * `EXPIRE 172800` (48 часов).
   *
   * При `seq > 99999` бросает `OrderNumberSequenceExhaustedError` ДО `fromParts`
   * (двойной рубеж защиты).
   */
  generate(dateYYMMDD: string): Promise<OrderNumber>
}
