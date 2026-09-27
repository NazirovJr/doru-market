import type { DeliveryAssignmentDetailView } from '../application/use-cases/get-delivery-assignment-detail.use-case.js'
import type { MineAssignmentView } from '../application/use-cases/get-mine-delivery-assignments.use-case.js'

export type DeliveryAssignmentDetailDto = DeliveryAssignmentDetailView
export type MineAssignmentDto = MineAssignmentView

// Тонкая идентичность (view уже JSON-safe) — единообразие со стилем delivery-offer.dto.ts.
export function toDeliveryAssignmentDetailDto(view: DeliveryAssignmentDetailView): DeliveryAssignmentDetailDto {
  return view
}

export function toMineAssignmentDto(view: MineAssignmentView): MineAssignmentDto {
  return view
}
