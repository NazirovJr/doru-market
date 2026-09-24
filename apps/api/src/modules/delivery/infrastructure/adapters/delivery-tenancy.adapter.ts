import { Inject, Injectable } from '@nestjs/common'
import { TENANT_REPOSITORY, TenantId, type TenantRepositoryPort } from '@/modules/tenancy/index.js'
import type { DeliveryTenancyPort } from '@/modules/delivery/application/ports/delivery-tenancy.port.js'
import { DELIVERY_TENANCY_PORT } from '@/modules/delivery/application/ports/delivery-tenancy.port.js'

// совпадает с дефолтом tenants.courier_sourcing_mode в БД
const DEFAULT_COURIER_SOURCING_MODE = 'platform_pool'

@Injectable()
export class DeliveryTenancyAdapter implements DeliveryTenancyPort {
  public constructor(@Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepositoryPort) {}

  public async getCourierSourcingMode(tenantId: string): Promise<'own_fleet' | 'platform_pool' | 'hybrid'> {
    const tenant = await this.tenantRepository.findById(TenantId.from(tenantId))
    return tenant?.courierSourcingMode.value ?? DEFAULT_COURIER_SOURCING_MODE
  }
}

export const DELIVERY_TENANCY_PORT_PROVIDER = {
  provide: DELIVERY_TENANCY_PORT,
  useClass: DeliveryTenancyAdapter,
} as const
