import type { DeliveryAssignmentDetailView } from '../application/use-cases/get-delivery-assignment-detail.use-case.js'
import type { MineAssignmentView } from '../application/use-cases/get-mine-delivery-assignments.use-case.js'

export type DeliveryAssignmentDetailDto = DeliveryAssignmentDetailView
export type MineAssignmentDto = MineAssignmentView

// Тонкая идентичность (view уже JSON-safe: bigint переведён в number use case'ом) — отдельная
// функция ради единообразия со стилем `delivery-offer.dto.ts` (presentation не мутирует domain view).
export function toDeliveryAssignmentDetailDto(view: DeliveryAssignmentDetailView): DeliveryAssignmentDetailDto {
  return view
}

export function toMineAssignmentDto(view: MineAssignmentView): MineAssignmentDto {
  return view
}
