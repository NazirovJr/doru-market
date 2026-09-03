/**
 * `ResolveDeliveryAddressService` (EP-09, DTJ-229) — unit-набор: сохранённый адрес / инлайн
 * валидный / инлайн невалидные координаты / landmark override (тест-план тикета).
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { InvalidCoordinatesError, NotFoundError, ValidationError } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type {
  UserAddressFacadePort,
  UserAddressSnapshot,
} from '@/modules/orders/application/ports/user-address-facade.port.js'
import type { CheckoutCommand } from './dto/checkout-command.dto.js'
import { ResolveDeliveryAddressService } from './resolve-delivery-address.service.js'

const CUSTOMER_ID = 'customer-1'

function geoPointOrThrow(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!result.ok) throw new Error('fixture: invalid GeoPoint')
  return result.value
}

function buildCommand(overrides: Partial<CheckoutCommand> = {}): CheckoutCommand {
  return {
    tenantId: 'tenant-1',
    customerId: CUSTOMER_ID,
    customerPhone: '+992900000000',
    cartItemIds: [],
    deliveryAddressId: null,
    inlineAddress: null,
    deliveryLandmark: null,
    paymentMethod: 'cash_courier',
    prescriptionIds: [],
    expectedTotalDiramByPharmacy: {},
    checkoutAttemptId: randomUUID(),
    ...overrides,
  }
}

function makeService(saved: UserAddressSnapshot | null = null): { service: ResolveDeliveryAddressService; getById: ReturnType<typeof vi.fn> } {
  const getById = vi.fn<UserAddressFacadePort['getById']>().mockResolvedValue(saved)
  const port: UserAddressFacadePort = { getById }
  return { service: new ResolveDeliveryAddressService(port), getById }
}

describe('ResolveDeliveryAddressService (DTJ-229)', () => {
  it('deliveryAddressId — сохранённый адрес существует и принадлежит customer → ResolvedAddress с его geoPoint', async () => {
    const saved: UserAddressSnapshot = {
      id: 'addr-1',
      addressText: 'Dushanbe, Rudaki 5',
      landmarkText: 'рядом с ЦУМ',
      geoPoint: geoPointOrThrow(38.56, 68.78),
    }
    const { service, getById } = makeService(saved)

    const result = await service.resolve(buildCommand({ deliveryAddressId: 'addr-1' }))

    expect(result).toEqual({ addressText: 'Dushanbe, Rudaki 5', landmark: 'рядом с ЦУМ', geoPoint: saved.geoPoint })
    expect(getById).toHaveBeenCalledWith('addr-1', CUSTOMER_ID)
  })

  it('deliveryAddressId — адрес не найден/чужой (порт вернул null) → NotFoundError', async () => {
    const { service } = makeService(null)
    await expect(service.resolve(buildCommand({ deliveryAddressId: 'addr-missing' }))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('AC5 — deliveryLandmark передан отдельно от сохранённого адреса → перезаписывает ТОЛЬКО для этого заказа', async () => {
    const saved: UserAddressSnapshot = {
      id: 'addr-1',
      addressText: 'Dushanbe, Rudaki 5',
      landmarkText: 'старый ориентир',
      geoPoint: geoPointOrThrow(38.56, 68.78),
    }
    const { service } = makeService(saved)

    const result = await service.resolve(buildCommand({ deliveryAddressId: 'addr-1', deliveryLandmark: 'новый ориентир' }))

    expect(result.landmark).toBe('новый ориентир')
    // Сохранённый адрес не мутирован — сервис не вызывает никакого write-метода порта.
  })

  it('инлайн-адрес — валидные координаты → ResolvedAddress с GeoPoint из GeoPoint.create', async () => {
    const { service } = makeService()
    const result = await service.resolve(
      buildCommand({ inlineAddress: { addressText: 'Dushanbe, Rudaki 1', landmarkText: null, latitude: 38.5598, longitude: 68.787 } }),
    )
    expect(result.addressText).toBe('Dushanbe, Rudaki 1')
    expect(result.geoPoint?.latitude).toBe(38.5598)
    expect(result.geoPoint?.longitude).toBe(68.787)
  })

  it('AC4 — инлайн-адрес, latitude=95 (вне диапазона) → InvalidCoordinatesError', async () => {
    const { service } = makeService()
    await expect(
      service.resolve(buildCommand({ inlineAddress: { addressText: 'x', landmarkText: null, latitude: 95, longitude: 68.787 } })),
    ).rejects.toBeInstanceOf(InvalidCoordinatesError)
  })

  it('инлайн-адрес — deliveryLandmark перезаписывает landmarkText инлайн-адреса', async () => {
    const { service } = makeService()
    const result = await service.resolve(
      buildCommand({
        inlineAddress: { addressText: 'x', landmarkText: 'старый', latitude: 38.5598, longitude: 68.787 },
        deliveryLandmark: 'новый',
      }),
    )
    expect(result.landmark).toBe('новый')
  })

  it('ни deliveryAddressId, ни inlineAddress не переданы → ValidationError', async () => {
    const { service } = makeService()
    await expect(service.resolve(buildCommand())).rejects.toBeInstanceOf(ValidationError)
  })

  it('оба переданы одновременно → ValidationError (взаимоисключающие)', async () => {
    const { service } = makeService()
    await expect(
      service.resolve(
        buildCommand({
          deliveryAddressId: 'addr-1',
          inlineAddress: { addressText: 'x', landmarkText: null, latitude: 38.5598, longitude: 68.787 },
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
