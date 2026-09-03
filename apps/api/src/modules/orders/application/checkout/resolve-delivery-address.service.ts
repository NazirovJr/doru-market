/**
 * `ResolveDeliveryAddressService` (EP-09, DTJ-229, SRS-DOM-072, SRS-ORD-024). Единственная
 * точка, где адрес доставки checkout превращается в `GeoPoint`/текст, до расчёта стоимости
 * (DTJ-228 нуждается в `GeoPoint` для `DeliveryFacadePort.calculateFee`) и до `Order.create()`.
 * Заменяет временную свободную функцию `resolveDeliveryAddress` (`checkout.util.ts`, DTJ-227
 * TODO) — та поддерживала ТОЛЬКО инлайн-адрес (`cmd.inlineAddress`), сохранённые адреса
 * (`cmd.deliveryAddressId`) бросали явную `ValidationError` с текстом «требует DTJ-229».
 *
 * Ровно ОДИН из `deliveryAddressId`/`inlineAddress` обязан быть ненулевым
 * (`CheckoutCommand` JSDoc, DTJ-227 «Что сделать» п.1) — оба состояния (ни одного/оба сразу)
 * защищены здесь явно, а не оставлены на неявное поведение (`??`).
 *
 * `deliveryLandmark`, если передан ОТДЕЛЬНО от `deliveryAddressId`, ПЕРЕЗАПИСЫВАЕТ
 * `landmark_text` ТОЛЬКО для ЭТОГО заказа (разовое уточнение) — сохранённый `user_addresses`
 * НЕ мутируется (`UserAddressFacadePort.getById` — чтение, `resolve()` не пишет никуда).
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError, ValidationError } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import {
  USER_ADDRESS_FACADE_PORT,
  type UserAddressFacadePort,
} from '@/modules/orders/application/ports/user-address-facade.port.js'
import type { CheckoutCommand, InlineDeliveryAddress } from './dto/checkout-command.dto.js'
import type { ResolvedAddress } from './checkout.util.js'

@Injectable()
export class ResolveDeliveryAddressService {
  constructor(
    @Inject(USER_ADDRESS_FACADE_PORT) private readonly userAddressFacade: UserAddressFacadePort,
  ) {}

  async resolve(cmd: CheckoutCommand): Promise<ResolvedAddress> {
    if (cmd.deliveryAddressId !== null && cmd.inlineAddress !== null) {
      throw new ValidationError('deliveryAddressId and inlineAddress are mutually exclusive', {
        checkoutAttemptId: cmd.checkoutAttemptId,
      })
    }
    if (cmd.deliveryAddressId !== null) {
      return this.resolveSaved(cmd.deliveryAddressId, cmd)
    }
    if (cmd.inlineAddress !== null) {
      return resolveInline(cmd.inlineAddress, cmd.deliveryLandmark)
    }
    throw new ValidationError('Either deliveryAddressId or inlineAddress is required', {
      checkoutAttemptId: cmd.checkoutAttemptId,
    })
  }

  /**
   * `getById(addressId, customerId)` — `null` покрывает И «не существует», И «чужой адрес»
   * (D-EP09-11/SRS-API-046, JSDoc порта) — единая `NotFoundError` (404), не отдельная
   * `Forbidden`-ветка: чужой ресурс по id не подтверждается как существующий.
   */
  private async resolveSaved(addressId: string, cmd: CheckoutCommand): Promise<ResolvedAddress> {
    const saved = await this.userAddressFacade.getById(addressId, cmd.customerId)
    if (saved === null) {
      throw new NotFoundError({ addressId, reason: 'delivery_address_not_found' })
    }
    return {
      addressText: saved.addressText,
      landmark: cmd.deliveryLandmark ?? saved.landmarkText,
      geoPoint: saved.geoPoint,
    }
  }
}

/** SRS-DOM-072 — координаты валидируются через `GeoPoint.create` (VO), разовый адрес не сохраняется. */
function resolveInline(inline: InlineDeliveryAddress, landmarkOverride: string | null): ResolvedAddress {
  const geoResult = GeoPoint.create(inline.latitude, inline.longitude)
  if (!geoResult.ok) {
    throw geoResult.error
  }
  return {
    addressText: inline.addressText,
    landmark: landmarkOverride ?? inline.landmarkText,
    geoPoint: geoResult.value,
  }
}
