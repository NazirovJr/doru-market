import { describe, expect, it } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { DeliveryZone } from './delivery-zone.entity.js'

function geoPoint(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

const CENTER = geoPoint(38.57, 68.78)

function validZone(radiusKm = 5): DeliveryZone {
  return DeliveryZone.create({ id: 'zone-1', tenantId: 'tenant-1', name: 'Zone A', center: CENTER, radiusKm, priority: 0 })
}

describe('DeliveryZone.create() — chk_delivery_zones_radius_positive', () => {
  it('валидная команда → is_active=true по умолчанию', () => {
    const zone = validZone()
    expect(zone.isActive).toBe(true)
    expect(zone.radiusKm).toBe(5)
  })

  it('radiusKm=0 → ValidationError', () => {
    expect(() => validZone(0)).toThrow(ValidationError)
  })

  it('radiusKm отрицательный → ValidationError', () => {
    expect(() => validZone(-1)).toThrow(ValidationError)
  })
})

describe('update() — SRS-DELIV-036 (PATCH), частичное обновление', () => {
  it('обновляет только переданные поля', () => {
    const zone = validZone().update({ name: 'Renamed' })
    expect(zone.props.name).toBe('Renamed')
    expect(zone.radiusKm).toBe(5)
  })

  it('обновление radiusKm на неположительное значение → ValidationError', () => {
    expect(() => validZone().update({ radiusKm: 0 })).toThrow(ValidationError)
  })
})

describe('getters/restore()', () => {
  it('id/tenantId/priority доступны, restore() восстанавливает props', () => {
    const original = validZone()
    expect(original.id).toBe('zone-1')
    expect(original.tenantId).toBe('tenant-1')
    expect(original.priority).toBe(0)
    const restored = DeliveryZone.restore(original.props)
    expect(restored.props).toEqual(original.props)
  })
})

describe('activate()/deactivate()', () => {
  it('deactivate() → isActive=false, activate() возвращает true', () => {
    const deactivated = validZone().deactivate()
    expect(deactivated.isActive).toBe(false)
    expect(deactivated.activate().isActive).toBe(true)
  })
})

describe('containsPoint() — SRS-DELIV-008/SRS-DOM-073', () => {
  it('точка в центре зоны — внутри', () => {
    expect(validZone(5).containsPoint(CENTER)).toBe(true)
  })

  it('точка ~1км от центра, радиус 5км — внутри', () => {
    const nearbyPoint = geoPoint(38.579, 68.78) // ~1km к северу
    expect(validZone(5).containsPoint(nearbyPoint)).toBe(true)
  })

  it('точка ~50км от центра, радиус 5км — снаружи', () => {
    const farPoint = geoPoint(39.0, 68.78) // ~48km к северу
    expect(validZone(5).containsPoint(farPoint)).toBe(false)
  })
})
