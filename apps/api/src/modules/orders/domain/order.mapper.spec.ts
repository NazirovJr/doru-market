import { describe, expect, it } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { Order } from './order.entity.js'
import { toOrderDto, toOrderItemDto } from './order.mapper.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { fixedDate } from '@/modules/orders/testing/fixtures/fixed-date.fixture.js'

describe('order.mapper (DTJ-221 «Что сделать» п.7)', () => {
  it('toOrderDto — денежные поля как number-дирамы, даты как ISO-строки', () => {
    const result = Order.create(validOrderCreateCommand())
    if (!isOk(result)) throw new Error('expected Ok')
    const dto = toOrderDto(result.value)
    expect(dto.orderNumber).toBe('DTJ-260827-00001')
    expect(dto.itemsTotalDiram).toBe(Number(result.value.itemsTotal.diram))
    expect(dto.createdAt).toBe('2026-08-27T10:00:00.000Z')
    expect(dto.courierId).toBeNull()
    expect(dto.slaDeadlineAt).toBeNull()
    expect(dto.billingStrategy).toBe('single_invoice') // DTJ-228 — снэпшот на момент checkout
  })

  it('toOrderDto — заполненные временные метки и отсутствующий geoPoint конвертируются в ISO/null', () => {
    const result = Order.create(validOrderCreateCommand({ deliveryGeoPoint: null }))
    if (!isOk(result)) throw new Error('expected Ok')
    const restored = Order.restore({
      ...result.value.toSnapshot(),
      slaDeadlineAt: fixedDate('2026-08-27T10:07:00.000Z'),
      processingStartedAt: fixedDate('2026-08-27T10:00:30.000Z'),
      pickedUpAt: fixedDate('2026-08-27T10:05:00.000Z'),
      deliveredAt: fixedDate('2026-08-27T10:20:00.000Z'),
    })
    const dto = toOrderDto(restored)
    expect(dto.deliveryLatitude).toBeNull()
    expect(dto.deliveryLongitude).toBeNull()
    expect(dto.slaDeadlineAt).toBe('2026-08-27T10:07:00.000Z')
    expect(dto.pickedUpAt).toBe('2026-08-27T10:05:00.000Z')
  })

  it('toOrderItemDto — привязывает orderId', () => {
    const result = Order.create(validOrderCreateCommand())
    if (!isOk(result)) throw new Error('expected Ok')
    const item = result.value.items[0]
    if (!item) throw new Error('expected item')
    const dto = toOrderItemDto(item, result.value.id)
    expect(dto.orderId).toBe(result.value.id)
    expect(dto.unitPriceDiram).toBe(Number(item.unitPrice.diram))
  })
})
