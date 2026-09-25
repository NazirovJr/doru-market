// DTJ-364: узкий подпорт admin поверх delivery — без createCourier роль courier может
// залогиниться, но никогда не начнёт смену (StartCourierShiftUseCase требует couriers-строку).
import type { CourierTaxStatus, CourierVehicleType } from '@dorutj/contracts'

export const DELIVERY_FACADE_PORT = Symbol.for('@dorutj/admin/delivery-facade')

export interface CourierSummaryView {
  readonly id: string
  readonly userId: string
  readonly chainId: string | null
  readonly vehicleType: CourierVehicleType
  readonly taxStatus: CourierTaxStatus
}

export interface CreateCourierFacadeCommand {
  readonly userId: string
  readonly chainId: string
}

export interface DeliveryFacadePort {
  findCourierByUserId(userId: string): Promise<CourierSummaryView | null>
  createCourier(command: CreateCourierFacadeCommand): Promise<CourierSummaryView>
}
