import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import type { IdGenerator } from '@/shared-kernel/index.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { AuditLogPort } from '@/common/audit/audit-log.port.js'
import { DeliveryZone } from '../../domain/delivery-zone.entity.js'
import type { DeliveryZoneRepositoryPort } from '../ports/delivery-zone.repository.port.js'
import { ManageDeliveryZonesUseCase } from './manage-delivery-zones.use-case.js'

const TENANT_ID = 'tenant-1'
const NEW_ZONE_ID = 'zone-new'
const SUPER_ADMIN = { userId: 'admin-1', role: 'super_admin' }
const PHARMACY_ADMIN = { userId: 'pa-1', role: 'pharmacy_admin' }

function geoPoint(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

function existingZone(): DeliveryZone {
  return DeliveryZone.create({
    id: 'zone-1',
    tenantId: TENANT_ID,
    name: 'Zone A',
    center: geoPoint(38.57, 68.78),
    radiusKm: 5,
    priority: 0,
  })
}

interface Harness {
  readonly useCase: ManageDeliveryZonesUseCase
  readonly saveMock: ReturnType<typeof vi.fn>
  readonly auditWrite: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { existing?: DeliveryZone | null } = {}): Harness {
  const saveMock = vi.fn().mockResolvedValue(undefined)
  const zonesRepo: DeliveryZoneRepositoryPort = {
    findById: vi.fn().mockResolvedValue(params.existing === undefined ? existingZone() : params.existing),
    findActiveCoverageCandidates: vi.fn().mockResolvedValue([]),
    findAllByTenant: vi.fn().mockResolvedValue([existingZone()]),
    save: saveMock,
  }
  const auditWrite = vi.fn().mockResolvedValue(undefined)
  const auditLog: AuditLogPort = { write: auditWrite }
  const ids: IdGenerator = { next: vi.fn(() => NEW_ZONE_ID) }
  return { useCase: new ManageDeliveryZonesUseCase(zonesRepo, auditLog, ids), saveMock, auditWrite }
}

describe('ManageDeliveryZonesUseCase — SRS-DELIV-036', () => {
  it('create: super_admin создаёт зону, сохраняет и пишет audit_log с crossTenantOverride=true', async () => {
    const { useCase, saveMock, auditWrite } = makeUseCase()
    const zone = await useCase.create({
      tenantId: TENANT_ID,
      name: 'Zone B',
      centerLat: 38.6,
      centerLon: 68.8,
      radiusKm: 3,
      priority: 1,
      isActive: true,
      actor: SUPER_ADMIN,
    })
    expect(zone.id).toBe(NEW_ZONE_ID)
    expect(saveMock).toHaveBeenCalledOnce()
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delivery_zone_create',
        metadata: { extra: { crossTenantOverride: true, tenantId: TENANT_ID } },
      }),
    )
  })

  it('create: не super_admin -> ForbiddenError, save не вызывается', async () => {
    const { useCase, saveMock } = makeUseCase()
    await expect(
      useCase.create({
        tenantId: TENANT_ID,
        name: 'Zone B',
        centerLat: 38.6,
        centerLon: 68.8,
        radiusKm: 3,
        priority: 1,
        isActive: true,
        actor: PHARMACY_ADMIN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('update: частично обновляет только переданные поля, сохраняет', async () => {
    const { useCase, saveMock } = makeUseCase()
    const updated = await useCase.update({ id: 'zone-1', tenantId: TENANT_ID, name: 'Renamed', actor: SUPER_ADMIN })
    expect(updated.props.name).toBe('Renamed')
    expect(updated.radiusKm).toBe(5) // не менялось
    expect(saveMock).toHaveBeenCalledOnce()
  })

  it('update: isActive=false -> деактивирует зону', async () => {
    const { useCase } = makeUseCase()
    const updated = await useCase.update({ id: 'zone-1', tenantId: TENANT_ID, isActive: false, actor: SUPER_ADMIN })
    expect(updated.isActive).toBe(false)
  })

  it('update: зона чужого тенанта (или не найдена) -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ existing: null })
    await expect(useCase.update({ id: 'zone-1', tenantId: TENANT_ID, name: 'x', actor: SUPER_ADMIN })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('list: не super_admin -> ForbiddenError', async () => {
    const { useCase } = makeUseCase()
    await expect(useCase.list(TENANT_ID, PHARMACY_ADMIN)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
