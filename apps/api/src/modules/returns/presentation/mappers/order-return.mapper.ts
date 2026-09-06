/**
 * `toOrderReturnDto` (EP-11, DTJ-275, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1) — `OrderReturn`
 * (domain) → `OrderReturnDto` (`packages/contracts/src/returns.ts`). Контроллер не возвращает
 * сущность БД/домен напрямую наружу — единственная точка маппинга, домен читается через
 * `OrderReturn.toSnapshot()` (тот же метод, что использует `ReturnsRepositoryPort`, DTJ-273).
 */
import type { OrderReturnDto } from '@dorutj/contracts'
import type { OrderReturn } from '@/modules/returns/application/ports/returns-repository.port.js'

export function toOrderReturnDto(orderReturn: OrderReturn): OrderReturnDto {
  const snapshot = orderReturn.toSnapshot()
  return {
    id: snapshot.id,
    orderId: snapshot.orderId,
    status: snapshot.status,
    reason: snapshot.reason.value,
    disposition: snapshot.disposition?.value ?? null,
    initiatedBy: snapshot.initiatedBy,
    courierId: snapshot.courierId,
    courierReturnFeeDiram: Number(snapshot.courierReturnFeeDiram.diram),
    packagingIntact: snapshot.packagingIntact,
    requestedAt: snapshot.requestedAt.toISOString(),
    resolvedAt: snapshot.resolvedAt?.toISOString() ?? null,
  }
}
