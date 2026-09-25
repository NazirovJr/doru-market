import type { DeliveryZone } from '../../domain/delivery-zone.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const DELIVERY_ZONE_REPOSITORY = Symbol.for('@dorutj/delivery/delivery-zone-repository')

export interface DeliveryZoneRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<DeliveryZone | null>
  /** Активные зоны тенанта + глобальные (`tenant_id IS NULL`) — кандидаты для резолюции покрытия
   * (DTJ-322, SRS-DELIV-048 шаг 1). Точное включение точки проверяет `DeliveryZone.containsPoint`. */
  findActiveCoverageCandidates(tenantId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryZone[]>
  /** Все зоны (включая неактивные) СВОЕГО тенанта — для админ-листинга `GET /delivery-zones`. */
  findAllByTenant(tenantId: string, tx?: DeliveryUnitOfWorkTx): Promise<readonly DeliveryZone[]>
  save(zone: DeliveryZone, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
