// CRUD delivery_zones. Роль — super_admin-only (ASSUMPTION: делегирование pharmacy_admin нигде
// явно не решено продуктом, см. отчёт сдачи). Актор всегда super_admin -> audit_log пишет
// crossTenantOverride=true на каждую мутацию.
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { GeoPoint, ID_GENERATOR, type IdGenerator } from '@/shared-kernel/index.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/common/audit/audit-log.port.js'
import { DeliveryZone, type DeliveryZoneUpdate } from '@/modules/delivery/domain/delivery-zone.entity.js'
import {
  DELIVERY_ZONE_REPOSITORY,
  type DeliveryZoneRepositoryPort,
} from '../ports/delivery-zone.repository.port.js'

/** Ре-экспорт: presentation не может импортировать /domain/ напрямую (dependency-cruiser). */
export type { DeliveryZone }

const SUPER_ADMIN_ROLE = 'super_admin'
// TODO(DTJ-322): нет своей category в audit_action_category enum — временно 'ledger_adjustment' (см. отчёт сдачи).
const AUDIT_CATEGORY = 'ledger_adjustment'
const AUDIT_ENTITY_TYPE = 'delivery_zone'

export interface DeliveryZoneActor {
  readonly userId: string
  readonly role: string
}

export interface CreateDeliveryZoneCommand {
  readonly tenantId: string
  readonly name: string
  readonly centerLat: number
  readonly centerLon: number
  readonly radiusKm: number
  readonly priority: number
  readonly isActive: boolean
  readonly actor: DeliveryZoneActor
}

export interface UpdateDeliveryZoneCommand {
  readonly id: string
  readonly tenantId: string
  readonly name?: string
  readonly centerLat?: number
  readonly centerLon?: number
  readonly radiusKm?: number
  readonly priority?: number
  readonly isActive?: boolean
  readonly actor: DeliveryZoneActor
}

@Injectable()
export class ManageDeliveryZonesUseCase {
  public constructor(
    @Inject(DELIVERY_ZONE_REPOSITORY) private readonly zones: DeliveryZoneRepositoryPort,
    @Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  public async list(tenantId: string, actor: DeliveryZoneActor): Promise<readonly DeliveryZone[]> {
    assertSuperAdmin(actor)
    return this.zones.findAllByTenant(tenantId)
  }

  public async create(cmd: CreateDeliveryZoneCommand): Promise<DeliveryZone> {
    assertSuperAdmin(cmd.actor)
    const zone = DeliveryZone.create({
      id: this.ids.next(),
      tenantId: cmd.tenantId,
      name: cmd.name,
      center: toGeoPoint(cmd.centerLat, cmd.centerLon),
      radiusKm: cmd.radiusKm,
      priority: cmd.priority,
    })
    const persisted = cmd.isActive ? zone : zone.deactivate()
    await this.zones.save(persisted)
    await this.writeAudit({ action: 'delivery_zone_create', zoneId: persisted.id, tenantId: cmd.tenantId, actor: cmd.actor })
    return persisted
  }

  public async update(cmd: UpdateDeliveryZoneCommand): Promise<DeliveryZone> {
    assertSuperAdmin(cmd.actor)
    const existing = await this.zones.findById(cmd.id)
    if (existing?.tenantId !== cmd.tenantId) {
      throw new NotFoundError({ deliveryZoneId: cmd.id })
    }
    let updated = existing.update(buildUpdatePatch(cmd, existing))
    if (cmd.isActive !== undefined) {
      updated = cmd.isActive ? updated.activate() : updated.deactivate()
    }
    await this.zones.save(updated)
    await this.writeAudit({ action: 'delivery_zone_update', zoneId: updated.id, tenantId: cmd.tenantId, actor: cmd.actor })
    return updated
  }

  private async writeAudit(params: {
    action: string
    zoneId: string
    tenantId: string
    actor: DeliveryZoneActor
  }): Promise<void> {
    await this.auditLog.write({
      category: AUDIT_CATEGORY,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: params.zoneId,
      actorUserId: params.actor.userId,
      action: params.action,
      metadata: { extra: { crossTenantOverride: true, tenantId: params.tenantId } },
      requestId: null,
      tenantId: params.tenantId,
    })
  }
}

/** `centerLat`/`centerLon` меняются вместе (заданное одно достраивается текущим значением). */
function buildUpdatePatch(cmd: UpdateDeliveryZoneCommand, existing: DeliveryZone): DeliveryZoneUpdate {
  const centerGiven = cmd.centerLat !== undefined || cmd.centerLon !== undefined
  return {
    ...(cmd.name !== undefined && { name: cmd.name }),
    ...(centerGiven && {
      center: toGeoPoint(cmd.centerLat ?? existing.props.center.latitude, cmd.centerLon ?? existing.props.center.longitude),
    }),
    ...(cmd.radiusKm !== undefined && { radiusKm: cmd.radiusKm }),
    ...(cmd.priority !== undefined && { priority: cmd.priority }),
  }
}

function assertSuperAdmin(actor: DeliveryZoneActor): void {
  if (actor.role !== SUPER_ADMIN_ROLE) {
    throw new ForbiddenError('ManageDeliveryZonesUseCase requires super_admin actor', { actorRole: actor.role })
  }
}

function toGeoPoint(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!isOk(result)) {
    throw result.error
  }
  return result.value
}
