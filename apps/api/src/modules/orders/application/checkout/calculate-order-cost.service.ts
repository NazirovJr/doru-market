/**
 * `CalculateOrderCostService` (EP-09, DTJ-228, SRS-DOM-008/009/066/160/162, SRS-ORD-021/022).
 *
 * Единственное место, где считается `items_total`/`total_amount` ГРУППЫ checkout и снэпшотится
 * `commission_bps`/`platform_fee_diram` НА КАЖДУЮ позицию. Вызывается из `CheckoutUseCase`
 * (`processGroup`, DTJ-227) ПОСЛЕ резерва остатка (реальная цена ЛОТА, `ReservedStockLine.
 * unitPriceDiram` — race-free источник, DTJ-227 п.«ВНИМАНИЕ»), ДО `Order.create()` — результат
 * передаётся в `OrderCreateCommand`, сам расчёт домену не принадлежит (`02` §3.2: use case
 * оркестрирует, домен только валидирует уже посчитанное).
 *
 * **Разделение ответственности (D-EP09-34, решение CTO, `reports/EP09-CTO-BRIEF.md`):** этот
 * сервис берёт `commissionBps` НА КАЖДУЮ позицию из уже резолвленной карты (DTJ-358 —
 * резолвинг вынесен вызывающим ДО транзакции, см. `CalculateOrderCostInput`); САМО округление
 * (`platformFeeDiram`) выполняет `OrderItem.create()` (`domain/order-item.entity.ts`,
 * `bankersRoundDivide` — целочисленное round-half-to-even на `bigint`, DTJ-221). Этот сервис
 * ПЕРЕИСПОЛЬЗУЕТ `OrderItem.create()` для превью суммы комиссии (правило 12 AGENTS.md — не
 * писать вторую реализацию округления денег, она разошлась бы на дирам с той, что реально
 * снэпшотится в `Order.create()` → `OrderItem.create()` тем же вызовом чуть ниже по стеку,
 * `checkout.util.ts::buildItemCommands`). `id`/`inventoryBatchId`, переданные здесь, —
 * заглушки-плейсхолдеры: они не участвуют в формуле округления (`unitPrice × quantity ×
 * commissionBps / 10000`), настоящие значения снэпшотятся позже, внутри `Order.create()`.
 *
 * Комиссия считается ИСКЛЮЧИТЕЛЬНО от `items_total` (SRS-DOM-009) — `deliveryFeeDiram` НЕ
 * передаётся ни в `resolveCommissionRate`, ни в формулу округления, только складывается с
 * `itemsTotalDiram` в `totalAmountDiram` НАПРЯМУЮ, отдельной строкой.
 *
 * `commissionCategory` резолвится из `isPrescriptionRequired` (`rx`/`otc`) — **известное
 * ограничение** (foundIssue, зафиксировано в отчёте сдачи): `CatalogFacadePort.
 * getMedicineSnapshot` не несёт `categories.commission_category`, поэтому третье значение
 * (`parapharma`) структурно недостижимо этим сервисом до расширения порта каталога (вне
 * периметра DTJ-228 — правка чужого, уже принятого порта). `chainId`/`pharmacyGeoPoint` —
 * аналогичный, отдельно задокументированный пробел (см. `CalculateOrderCostInput`).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { GeoPoint } from '@/shared-kernel/index.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { OrderItem } from '@/modules/orders/domain/order-item.entity.js'
import {
  DELIVERY_FACADE_PORT,
  type DeliveryFacadePort,
} from '@/modules/orders/application/ports/delivery-facade.port.js'
import type { CommissionCategory } from '@/modules/orders/application/ports/tenancy-facade.port.js'

const ZERO_DIRAM = 0n
/** Плейсхолдер, не участвующий в формуле округления — см. JSDoc файла. */
const PREVIEW_PLACEHOLDER = 'preview'

export interface OrderCostLineInput {
  readonly medicineId: string
  readonly unitPriceDiram: bigint
  readonly quantity: number
  readonly isPrescriptionRequired: boolean
}

export interface OrderCostLineResult {
  readonly medicineId: string
  readonly commissionBps: number
  readonly platformFeeDiram: bigint
}

/** Объект-параметр `calculate` (C5, `max-params` ≤3). */
export interface CalculateOrderCostInput {
  readonly tenantId: string
  /**
   * `null` — независимая аптека/нейтральный тенант (D-03) ИЛИ пробел: `OnboardingFacadePort`
   * не резолвит принадлежность аптеки к сети (foundIssue, вне периметра DTJ-228) — `orders`
   * сейчас структурно не может передать сюда реальный `chainId`.
   */
  readonly chainId: string | null
  readonly items: readonly OrderCostLineInput[]
  /**
   * `null` — `OnboardingFacadePort` не несёт координат аптеки (foundIssue, тот же класс, что
   * `chainId` выше). Delivery fee резолвится в `0` без вызова порта, если `null` (см. `resolveDeliveryFee`).
   */
  readonly pharmacyGeoPoint: GeoPoint | null
  /**
   * `null` — доработка интеграции (DTJ-229): `ResolveDeliveryAddressService` резолвит
   * `GeoPoint` только для инлайн/сохранённого адреса С координатами; сохранённый
   * `user_addresses` без `latitude`/`longitude` (колонки nullable, DTJ-014) даёт `null`.
   * Не мешает расчёту — `resolveDeliveryFee` ниже уже безопасен к `pharmacyGeoPoint === null`
   * (текущий известный пробел, JSDoc файла), при обоих `null` фактически то же самое: порт не
   * вызывается, `deliveryFeeDiram` резолвится в `0`.
   */
  readonly deliveryGeoPoint: GeoPoint | null
  /** DTJ-358 регресс-фикс — резолвлено `CheckoutUseCase.processGroup` ДО tx группы (self-deadlock пула, см. её JSDoc); сервис в БД сам не ходит. */
  readonly commissionRatesByCategory: ReadonlyMap<CommissionCategory, number>
}

export interface OrderCostResult {
  readonly items: readonly OrderCostLineResult[]
  readonly itemsTotalDiram: bigint
  readonly deliveryFeeDiram: bigint
  readonly totalAmountDiram: bigint
}

@Injectable()
export class CalculateOrderCostService {
  constructor(@Inject(DELIVERY_FACADE_PORT) private readonly deliveryFacade: DeliveryFacadePort) {}

  async calculate(input: CalculateOrderCostInput): Promise<OrderCostResult> {
    const itemsTotalDiram = input.items.reduce((sum, item) => sum + item.unitPriceDiram * BigInt(item.quantity), ZERO_DIRAM)
    const items = this.calculateLines(input)
    const deliveryFeeDiram = await this.resolveDeliveryFee(input, itemsTotalDiram)
    return {
      items,
      itemsTotalDiram,
      deliveryFeeDiram,
      totalAmountDiram: itemsTotalDiram + deliveryFeeDiram,
    }
  }

  /** SRS-ORD-021/022 — `commissionBps` на КАЖДУЮ позицию, из уже резолвленной карты (см. JSDoc `commissionRatesByCategory`). */
  private calculateLines(input: CalculateOrderCostInput): readonly OrderCostLineResult[] {
    return input.items.map((item): OrderCostLineResult => {
      const category = toCommissionCategory(item.isPrescriptionRequired)
      const commissionBps = input.commissionRatesByCategory.get(category)
      if (commissionBps === undefined) {
        throw new Error(`calculateLines: no pre-resolved commission rate for category "${category}" — caller must resolve all needed categories before calling calculate()`)
      }
      const preview = OrderItem.create({
        id: PREVIEW_PLACEHOLDER,
        medicineId: item.medicineId,
        unitPrice: Money.fromDiram(item.unitPriceDiram),
        quantity: item.quantity,
        commissionBps,
        inventoryBatchId: PREVIEW_PLACEHOLDER,
      })
      return { medicineId: item.medicineId, commissionBps, platformFeeDiram: preview.platformFeeDiram }
    })
  }

  /**
   * SRS-ORD-018 шаг 4e — оба `null`-случая (`pharmacyGeoPoint`/`deliveryGeoPoint`, JSDoc
   * `CalculateOrderCostInput`) пропускают вызов порта: без ОБЕИХ точек `calculateFee` не может
   * вернуть осмысленное расстояние.
   */
  private async resolveDeliveryFee(input: CalculateOrderCostInput, itemsTotalDiram: bigint): Promise<bigint> {
    if (input.pharmacyGeoPoint === null || input.deliveryGeoPoint === null) {
      return ZERO_DIRAM
    }
    return this.deliveryFacade.calculateFee({
      pharmacyGeoPoint: input.pharmacyGeoPoint,
      deliveryGeoPoint: input.deliveryGeoPoint,
      tenantId: input.tenantId,
      itemsTotalDiram,
    })
  }
}

/** rx/otc — см. «известное ограничение» в JSDoc файла (parapharma структурно недостижимо). */
function toCommissionCategory(isPrescriptionRequired: boolean): CommissionCategory {
  return isPrescriptionRequired ? 'rx' : 'otc'
}
