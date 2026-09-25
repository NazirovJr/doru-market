// DTJ-364: узкий подпорт admin поверх DeliveryFacade (межмодульно — только через фасад).
import type { CourierTaxStatus, CourierVehicleType } from '@dorutj/contracts'

export const DELIVERY_FACADE_PORT = Symbol.for('@dorutj/admin/delivery-facade')

export interface CourierSummaryView {
  readonly id: string
  readonly userId: string
  readonly chainId: string | null
  readonly vehicleType: CourierVehicleType
  readonly taxStatus: CourierTaxStatus
}

export interface ProvisionCourierFacadeCommand {
  readonly userId: string
  readonly chainId: string
}

export interface DeliveryFacadePort {
  provisionCourier(command: ProvisionCourierFacadeCommand): Promise<CourierSummaryView>
}
