/**
 * `ExcludeUnverifiedRxItemsService` (EP-09, DTJ-230, SRS-DOM-004/180, SRS-ORD-014/015/016).
 *
 * Вызывается из `CheckoutUseCase` шагом ПЕРВЫМ (SRS-ORD-018 шаг 4a), ДО расчёта стоимости
 * (DTJ-228) — исключённые позиции не участвуют ни в одной сумме. Rx-позиция без
 * верифицированного рецепта молча исключается из ПОПЫТКИ оформления (остаётся в корзине —
 * checkout ТОЛЬКО читает `cart_items`, не мутирует их на исключение), не блокирует весь
 * checkout: корзина из 3 позиций, где одна требует рецепта, даёт 2 оформленных заказа и
 * честное `meta.excludedItems` по третьей.
 *
 * «Given ВСЕ позиции группы (по аптеке) исключены → группа не формирует заказ вовсе» — НЕ
 * отдельная ветка этого сервиса: `SplitCartByPharmacyUseCase`/`buildPharmacyGroups`
 * (`CheckoutUseCase`) строит группы ТОЛЬКО из `orderable`-остатка, пустая группа просто не
 * появляется как ключ группировки. «Given ПОСЛЕ исключения по ВСЕМ группам не осталось ни
 * одной заказываемой позиции → `NoOrderableItemsError`» — тоже не здесь: `CheckoutUseCase.
 * runCheckout` уже бросает её, когда `orders.length === 0` (DTJ-227, существующий код) —
 * пустой `orderable` этого сервиса естественно каскадирует в пустой список групп → пустой
 * список заказов → тот же бросок, без дублирования проверки.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  PRESCRIPTIONS_FACADE_PORT,
  type PrescriptionsFacadePort,
} from '@/modules/orders/application/ports/prescriptions-facade.port.js'

/** SRS-ORD-015 — единственная причина исключения этого сервиса (DoD: именованная константа). */
export const PRESCRIPTION_NOT_VERIFIED_REASON = 'PRESCRIPTION_NOT_VERIFIED'

export interface RxCheckItem {
  readonly cartItemId: string
  readonly medicineId: string
  readonly isPrescriptionRequired: boolean
}

export interface ExcludedRxItem {
  readonly cartItemId: string
  readonly reason: typeof PRESCRIPTION_NOT_VERIFIED_REASON
}

export interface ExcludeRxItemsResult {
  readonly orderable: readonly RxCheckItem[]
  readonly excluded: readonly ExcludedRxItem[]
}

@Injectable()
export class ExcludeUnverifiedRxItemsService {
  constructor(
    @Inject(PRESCRIPTIONS_FACADE_PORT) private readonly prescriptionsFacade: PrescriptionsFacadePort,
  ) {}

  /**
   * `prescriptionIds` — часть контракта тикета («Что сделать» п.1), НЕ передаётся в
   * `PrescriptionsFacadePort.isVerifiedFor` — порт (DTJ-220) резолвит «покрыт ли рецептом»
   * ПО ДАННЫМ СЕРВЕРА (`customerId` + `medicineId`), не по клиентскому списку id: клиентский
   * список — недоверенный ввод (тот же принцип, что игнорирование `expectedTotalDiramByPharmacy`
   * в расчёте стоимости, DTJ-228 AC4) — сервер сам решает, покрыт ли медикамент, а не проверяет
   * присутствие id в присланном списке.
   */
  async exclude(items: readonly RxCheckItem[], prescriptionIds: readonly string[], customerId: string): Promise<ExcludeRxItemsResult> {
    void prescriptionIds
    const verifiedByMedicine = await this.resolveVerifiedRxMedicines(items, customerId)
    const orderable: RxCheckItem[] = []
    const excluded: ExcludedRxItem[] = []
    for (const item of items) {
      if (item.isPrescriptionRequired && verifiedByMedicine.get(item.medicineId) !== true) {
        excluded.push({ cartItemId: item.cartItemId, reason: PRESCRIPTION_NOT_VERIFIED_REASON })
      } else {
        orderable.push(item)
      }
    }
    return { orderable, excluded }
  }

  /** Одна проверка на УНИКАЛЬНЫЙ Rx-medicineId (не на позицию) — тот же приём против N+1, что `CatalogFacadePort`. */
  private async resolveVerifiedRxMedicines(items: readonly RxCheckItem[], customerId: string): Promise<ReadonlyMap<string, boolean>> {
    const rxMedicineIds = [...new Set(items.filter((item) => item.isPrescriptionRequired).map((item) => item.medicineId))]
    const entries = await Promise.all(
      rxMedicineIds.map(async (medicineId) => [medicineId, await this.prescriptionsFacade.isVerifiedFor(customerId, [medicineId])] as const),
    )
    return new Map(entries)
  }
}
