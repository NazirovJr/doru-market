/**
 * `ExtendCartHoldUseCase` (EP-09, DTJ-224, «Что сделать» §5, SRS-ORD-005).
 *
 * Продлевает мягкие Redis-холды ВСЕХ строк корзины на `CART_HOLD_TTL_SECONDS`. Вызывается
 * presentation-слоем (DTJ-225/226) на `GET /api/v1/cart?extendHold=true` — сам use case ничего
 * не знает про HTTP query-параметры (ticket §3), только `tenantId`+`cartId`.
 *
 * `tenantId` — ПЕРВЫЙ параметр (SRS-API-043, тот же приём, что остальные use case'ы `cart/**`,
 * DTJ-223): источник — presentation-слой, use case не читает `TenantContext` сам.
 * `findItemsByCartId` уже тенант-скоупит атомарно (`DrizzleCartRepository`, `EXISTS` по `cart`)
 * — чужой тенант ⇒ `[]` ⇒ `Promise.all([])` — безопасный no-op, отдельная проверка владения
 * не нужна (SRS-API-046: чужой тенант не подтверждает существование корзины, не ошибка).
 *
 * Каждая строка продлевается НЕЗАВИСИМО (C14, `no-await-in-loop`) — `Promise.all`, не
 * `for...await`: холды разных строк не пересекаются по ключу, гонки между ними нет.
 */
import { Inject, Injectable } from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'
import { CART_HOLD_STORE_PORT, type CartHoldStorePort } from '../ports/cart-hold-store.port.js'
import { CART_REPOSITORY, type CartRepository } from './ports/cart.repository.port.js'

@Injectable()
export class ExtendCartHoldUseCase {
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepository: CartRepository,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(CART_HOLD_STORE_PORT) private readonly cartHoldStore: CartHoldStorePort,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async execute(tenantId: string, cartId: string): Promise<void> {
    const items = await this.cartRepository.findItemsByCartId(tenantId, cartId)
    const ttlSeconds = this.config.cartHoldTtlSeconds
    await Promise.all(
      items.map((item) =>
        this.cartHoldStore.extend({
          pharmacyId: item.pharmacyId,
          medicineId: item.medicineId,
          cartItemId: item.id,
          ttlSeconds,
        }),
      ),
    )
  }
}
