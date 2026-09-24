/**
 * `DeliveryTenancyAdapter` (EP-13, DTJ-314) — реализация `DeliveryTenancyPort` поверх
 * `TenantRepositoryPort` (`@/modules/tenancy`, DTJ-052). 1:1 паттерн `modules/orders/
 * infrastructure/adapters/tenancy-facade.adapter.ts` (DTJ-228/229): узкий адаптер поверх чужого
 * публичного порта, не прямой доступ к `tenancy`-инфраструктуре/БД.
 *
 * `TENANT_REPOSITORY` — добавлен в экспорт `modules/tenancy/index.ts` ЭТИМ тикетом (D-27:
 * добавление одной строки), тот же приём, что DTJ-229 добавил `TENANT_SETTINGS_REPOSITORY` для
 * своего собственного адаптера.
 */
import { Inject, Injectable } from '@nestjs/common'
import { TENANT_REPOSITORY, TenantId, type TenantRepositoryPort } from '@/modules/tenancy/index.js'
import type { DeliveryTenancyPort } from '@/modules/delivery/application/ports/delivery-tenancy.port.js'
import { DELIVERY_TENANCY_PORT } from '@/modules/delivery/application/ports/delivery-tenancy.port.js'

/** `tenants.courier_sourcing_mode` дефолт (`0002_tenants_and_settings.sql`) — совпадает с БД. */
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
