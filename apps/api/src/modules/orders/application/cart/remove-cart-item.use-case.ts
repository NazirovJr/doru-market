/**
 * `RemoveCartItemUseCase` (EP-09, DTJ-223, «Что сделать» §3; тенант-изоляция — доработка по
 * замечанию CTO, SRS-API-043/046).
 *
 * `DELETE FROM cart_items WHERE id = :cartItemId AND cart_id = :cartId AND EXISTS (SELECT 1
 * FROM cart WHERE id = :cartId AND tenant_id = :tenantId)` — скоуп по `cartId` И `tenantId`,
 * атомарно внутри одного SQL-оператора (`DrizzleCartRepository.deleteItem`). `tenantId` —
 * ПЕРВЫЙ параметр `execute` (SRS-API-043, не опционален — вызов без него не компилируется),
 * источник — presentation-слой (DTJ-226), use case НЕ читает `TenantContext` сам.
 *
 * ПРИМЕЧАНИЕ (foundIssues DTJ-223): текст тикета объявляет сигнатуру как
 * `execute(cartItemId)`, но тело того же пункта требует `WHERE id = :id AND cart_id =
 * :cartId` — без `cartId` условие невыполнимо. Сигнатура здесь несёт оба параметра плюс
 * `tenantId`.
 *
 * Не бросает при отсутствии строки/чужой корзине/чужом тенанте — это не бизнес-ошибка (DELETE
 * идемпотентен по своей природе), вызывающий получает `removed: false` и решает сам
 * (presentation может вернуть 404, если это важно для клиента — SRS-API-046: чужой тенант не
 * подтверждает существование строки, поэтому `removed: false`, не `Forbidden`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { CART_REPOSITORY, type CartRepository } from './ports/cart.repository.port.js'

export interface RemoveCartItemResult {
  readonly removed: boolean
}

@Injectable()
export class RemoveCartItemUseCase {
  constructor(@Inject(CART_REPOSITORY) private readonly cartRepository: CartRepository) {}

  async execute(tenantId: string, cartId: string, cartItemId: string): Promise<RemoveCartItemResult> {
    const removed = await this.cartRepository.deleteItem(tenantId, cartId, cartItemId)
    return { removed }
  }
}
