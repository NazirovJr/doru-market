import type { DeliveryZone } from '../application/use-cases/manage-delivery-zones.use-case.js'

export interface DeliveryZoneViewDto {
  readonly id: string
  readonly tenantId: string | null
  readonly name: string
  readonly centerLat: number
  readonly centerLon: number
  readonly radiusKm: number
  readonly priority: number
  readonly isActive: boolean
}

export function toDeliveryZoneViewDto(zone: DeliveryZone): DeliveryZoneViewDto {
  return {
    id: zone.id,
    tenantId: zone.tenantId,
    name: zone.props.name,
    centerLat: zone.props.center.latitude,
    centerLon: zone.props.center.longitude,
    radiusKm: zone.radiusKm,
    priority: zone.priority,
    isActive: zone.isActive,
  }
}
