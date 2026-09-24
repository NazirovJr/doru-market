/**
 * `CourierShiftViewDto` (EP-13, DTJ-320) — форма ответа `POST /courier-shifts`/`.../:id/end`.
 * Денежные поля — `number` целых дирамов на границе JSON (правило 6 AGENTS.md, 1:1 приём
 * `cart-view.mapper.ts`: `Number(money.diram)`) — `CourierShiftSnapshot` несёт `Money`/`bigint`,
 * ни один из которых Fastify не сериализует напрямую (`Money` — приватный конструктор с полем
 * `bigint`, `discrepancyDiram` — голый `bigint`; оба ломают `JSON.stringify` без явной конвертации).
 */
import type { CourierShiftSnapshot } from '../application/use-cases/end-courier-shift.use-case.js'

export interface CourierShiftViewDto {
  readonly id: string
  readonly courierId: string
  readonly status: CourierShiftSnapshot['status']
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly openingCashOnHandDiram: number
  readonly cashCollectedDiram: number
  readonly cashSubmittedDiram: number | null
  readonly discrepancyDiram: number | null
}

export function toCourierShiftViewDto(snapshot: CourierShiftSnapshot): CourierShiftViewDto {
  return {
    id: snapshot.id,
    courierId: snapshot.courierId,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    openingCashOnHandDiram: Number(snapshot.openingCashOnHandDiram.diram),
    cashCollectedDiram: Number(snapshot.cashCollectedDiram.diram),
    cashSubmittedDiram: snapshot.cashSubmittedDiram === null ? null : Number(snapshot.cashSubmittedDiram.diram),
    discrepancyDiram: snapshot.discrepancyDiram === null ? null : Number(snapshot.discrepancyDiram),
  }
}
