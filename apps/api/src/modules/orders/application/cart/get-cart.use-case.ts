/**
 * `GetCartUseCase` (EP-09, DTJ-225, SRS-ORD-010..012).
 *
 * Единственное место, где живая цена (`CatalogFacadePort.getMedicineSnapshot`) и живой остаток
 * (`AvailabilityCalculator.getAvailableQuantity`, DTJ-224) собираются в ответ, сгруппированный
 * по аптекам (`SplitCartByPharmacyUseCase`, DTJ-223), с честными предупреждениями о нехватке
 * остатка. Сравнение «изменилась ли цена с последнего просмотра» (SRS-ORD-011) —
 * ОТВЕТСТВЕННОСТЬ ФРОНТЕНДА (клиент сравнивает с ранее полученным значением сам); этот use
 * case лишь гарантирует АКТУАЛЬНОСТЬ на момент своего вызова.
 *
 * `tenantId` — ПЕРВЫЙ параметр `execute` (SRS-API-043, тот же приём, что остальные use case'ы
 * `cart/**`, DTJ-223/224) — ticket «Технический контекст» пишет сигнатуру как `execute(cartId)`,
 * без tenantId (тот же foundIssue, что уже фиксировался в `RemoveCartItemUseCase`/
 * `ExtendCartHoldUseCase` — SRS-API-043 не опция).
 *
 * Батчинг (DoD DTJ-225 — «не выполняет N+1 запросов»): РОВНО ОДИН вызов `getMedicineSnapshot`
 * на ВСЕ уникальные `medicineId` корзины, переиспользуемый И для `items[]`, И для
 * `SplitCartByPharmacyUseCase` (не два раздельных вызова — «Риски» тикета: два вызова дали бы
 * гонку чтения между `items[].priceTjs` и `pharmacyGroups[].subtotalDiram`). Аналогично — РОВНО
 * ОДИН вызов `OnboardingFacadePort.getPharmacyNames` на все уникальные `pharmacyId`.
 * `getAvailableQuantity` — `Promise.all` по всем строкам (C14), не `for...await`.
 *
 * Медикамент, снятый с публикации/удалённый ПОСЛЕ добавления в корзину (снапшот отсутствует в
 * батч-ответе) — строка ИСКЛЮЧАЕТСЯ из `items[]`, `cart_items` НЕ трогается (не наше право
 * тихо удалять данные пользователя) — не бросаем `NotFoundError`, чтобы одна протухшая позиция
 * не роняла просмотр всей корзины. Не покрыто явным критерием приёмки тикета — ASSUMPTION.
 *
 * `pharmacyName` (доработка по замечанию CTO, отчёт сдачи DTJ-225) — `OnboardingFacadePort.
 * getPharmacyNames`, отсутствие записи → `null`, НИКОГДА не `pharmacyId` (см. JSDoc
 * `cart-view.dto.ts`/`split-cart-by-pharmacy.use-case.ts`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CATALOG_FACADE_PORT, type CatalogFacadePort, type MedicineOrderSnapshot } from '../ports/catalog-facade.port.js'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import { AvailabilityCalculator } from './availability-calculator.service.js'
import { SplitCartByPharmacyUseCase, type PricedCartLineItem } from './split-cart-by-pharmacy.use-case.js'
import { CART_REPOSITORY, type CartItemRecord, type CartRepository } from './ports/cart.repository.port.js'
import {
  CART_ITEM_WARNING_INSUFFICIENT_STOCK,
  type CartInsufficientStockWarning,
  type CartItemViewDto,
  type CartViewDto,
} from './dto/cart-view.dto.js'

interface AssembledRows {
  readonly itemViews: CartItemViewDto[]
  readonly warnings: CartInsufficientStockWarning[]
  readonly pricedLines: PricedCartLineItem[]
}

/** Объект-параметр `assembleRows` (C5, `max-params` ≤3) — 3 батч-результата свёрнуты в один. */
interface CartRowLookups {
  readonly snapshots: ReadonlyMap<string, MedicineOrderSnapshot>
  readonly pharmacyNames: ReadonlyMap<string, string>
  readonly availableQuantities: readonly number[]
}

/** Объект-параметр `toItemView`/`toPricedLine` (C5) — резолвнутые для ОДНОЙ строки значения. */
interface ResolvedRow {
  readonly snapshot: MedicineOrderSnapshot
  readonly pharmacyName: string | null
  readonly availableQuantity: number
}

@Injectable()
export class GetCartUseCase {
  // eslint-disable-next-line max-params -- 5 зависимостей (репозиторий + 3 порта/сервиса + группировка), тот же приём, что RequestOtpUseCase (auth/application/use-cases/request-otp.use-case.ts) — явные @Inject-параметры сохраняют граф зависимостей видимым в providers[] модуля.
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepository: CartRepository,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(CATALOG_FACADE_PORT) private readonly catalogFacadePort: CatalogFacadePort,
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacadePort: OnboardingFacadePort,
    @Inject(AvailabilityCalculator) private readonly availabilityCalculator: AvailabilityCalculator,
    @Inject(SplitCartByPharmacyUseCase) private readonly splitCartByPharmacy: SplitCartByPharmacyUseCase,
  ) {}

  async execute(tenantId: string, cartId: string): Promise<CartViewDto> {
    const cart = await this.cartRepository.findById(tenantId, cartId)
    if (cart === null) {
      throw new NotFoundError({ resource: 'cart', cartId })
    }

    const items = await this.cartRepository.findItemsByCartId(tenantId, cartId)
    if (items.length === 0) {
      return { items: [], meta: { pharmacyGroups: [], warnings: [] } }
    }
    return this.buildView(items)
  }

  private async buildView(items: readonly CartItemRecord[]): Promise<CartViewDto> {
    const medicineIds = [...new Set(items.map((item) => item.medicineId))]
    const pharmacyIds = [...new Set(items.map((item) => item.pharmacyId))]
    const [snapshots, pharmacyNames, availableQuantities] = await Promise.all([
      this.catalogFacadePort.getMedicineSnapshot(medicineIds),
      this.onboardingFacadePort.getPharmacyNames(pharmacyIds),
      Promise.all(
        items.map((item) =>
          this.availabilityCalculator.getAvailableQuantity(item.pharmacyId, item.medicineId, item.id),
        ),
      ),
    ])

    const { itemViews, warnings, pricedLines } = this.assembleRows(items, { snapshots, pharmacyNames, availableQuantities })
    const pharmacyGroups = this.splitCartByPharmacy.execute(pricedLines)
    return { items: itemViews, meta: { pharmacyGroups, warnings } }
  }

  private assembleRows(items: readonly CartItemRecord[], lookups: CartRowLookups): AssembledRows {
    const itemViews: CartItemViewDto[] = []
    const warnings: CartInsufficientStockWarning[] = []
    const pricedLines: PricedCartLineItem[] = []
    items.forEach((item, index) => {
      const snapshot = lookups.snapshots.get(item.medicineId)
      if (snapshot === undefined) {
        return
      }
      // ЗАПРЕЩЕНО подставлять item.pharmacyId вместо неизвестного имени (замечание CTO,
      // отчёт сдачи DTJ-225) — `null`, если OnboardingFacadePort не вернул запись.
      const resolved: ResolvedRow = {
        snapshot,
        pharmacyName: lookups.pharmacyNames.get(item.pharmacyId) ?? null,
        availableQuantity: lookups.availableQuantities[index] ?? 0,
      }
      itemViews.push(toItemView(item, resolved))
      if (item.quantity > resolved.availableQuantity) {
        warnings.push({
          cartItemId: item.id,
          type: CART_ITEM_WARNING_INSUFFICIENT_STOCK,
          availableQuantity: resolved.availableQuantity,
        })
      }
      pricedLines.push(toPricedLine(item, resolved))
    })
    return { itemViews, warnings, pricedLines }
  }
}

function toItemView(item: CartItemRecord, resolved: ResolvedRow): CartItemViewDto {
  return {
    id: item.id,
    cartId: item.cartId,
    medicineId: item.medicineId,
    medicineTradeName: resolved.snapshot.tradeName,
    pharmacyId: item.pharmacyId,
    pharmacyName: resolved.pharmacyName,
    quantity: item.quantity,
    priceDiram: resolved.snapshot.unitPriceDiram,
    availableQuantity: resolved.availableQuantity,
    addedAt: item.addedAt,
  }
}

function toPricedLine(item: CartItemRecord, resolved: ResolvedRow): PricedCartLineItem {
  return {
    medicineId: item.medicineId,
    medicineTradeName: resolved.snapshot.tradeName,
    pharmacyId: item.pharmacyId,
    pharmacyName: resolved.pharmacyName,
    quantity: item.quantity,
    unitPriceDiram: resolved.snapshot.unitPriceDiram,
  }
}
