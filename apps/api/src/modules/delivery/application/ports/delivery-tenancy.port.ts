export const DELIVERY_TENANCY_PORT = Symbol.for('@dorutj/delivery/tenancy-port')

export interface DeliveryTenancyPort {
  getCourierSourcingMode(tenantId: string): Promise<'own_fleet' | 'platform_pool' | 'hybrid'>
}
