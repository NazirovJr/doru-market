/**
 * `AddCartItemUseCase` (EP-09, DTJ-223, SRS-ORD-001..004/SRS-DOM-175; тенант-изоляция —
 * доработка по замечанию CTO, SRS-API-043/046).
 *
 * 1. Наркотик/психотроп (`controlCategory ∈ {psychotropic, narcotic}`) → `Err`,
 *    `ControlledSubstanceNotOrderableError`, строка НЕ создаётся (SRS-ORD-003).
 * 2. Упсёрт в `cart_items` по `(cartId, medicineId, pharmacyId)` — если строка уже
 *    существует, `quantity` УВЕЛИЧИВАЕТСЯ на переданное значение, не перезаписывается
 *    (`unique_cart_medicine_pharmacy`, критерий приёмки №1).
 * 3. Пересечение действующих веществ с уже лежащими в корзине ДРУГИМИ медикаментами
 *    (не с самим собой на другой аптеке — это тот же товар, не «дублирующееся вещество»)
 *    → `CartWarningEvent(type='duplicate_substance')` в `warnings` — добавление РАЗРЕШЕНО,
 *    предупреждение не блокирует (SRS-ORD-004, SRS-DOM-175).
 *
 * Существование корзины/медикамента — `NotFoundError` (`throw`, не `Result`): это не
 * бизнес-правило про сам медикамент, а невалидный вход вызывающего (устаревший/подделанный
 * `cartId`/`medicineId`, либо корзина другого тенанта — SRS-API-046 требует ИМЕННО `404`, не
 * `403`, чужой тенант не подтверждает существование корзины), тот же приём, что в
 * `get-medicine-detail.use-case.ts` (`catalog`) — `Result` здесь резервируется под критерий
 * приёмки №2 (контролируемое вещество), единственную ошибку, которую явно требует тест-план
 * тикета.
 *
 * `tenantId` — ПЕРВОЕ поле `AddCartItemInput`, ОБЯЗАТЕЛЬНОЕ (SRS-API-043): источник —
 * `TenantContext`, но читает его presentation-слой (DTJ-226) и передаёт сюда явным
 * параметром — use case НЕ обращается к `AsyncLocalStorage` сам (то же требование, что и
 * к `CartRepository`, JSDoc порта). Прокидывается в КАЖДЫЙ вызов репозитория; повторная
 * `NotFoundError` после `upsertItem` — на случай гонки (корзина удалена/сменила тенанта
 * между `findById`-проверкой и `upsertItem`, которая сама атомарно тенант-скоупит запись:
 * см. JSDoc `DrizzleCartRepository.upsertItem`), а не дублирующая проверка «на всякий случай».
 *
 * `CartHoldStorePort.hold(...)` (DTJ-224, «Что сделать» §4) — ставится на успешное добавление
 * (`ok`-ветка), количеством ИЗ `item.quantity` (значение ПОСЛЕ upsert, не `input.quantity`):
 * `hold` перезаписывает значение по ключу (`SET`), а не суммирует — вызов с накопленным
 * количеством корректно отражает ТЕКУЩИЙ суммарный резерв этой строки при повторном добавлении
 * того же товара (критерий приёмки №1 DTJ-223). Деградация Redis не блокирует эту ветку —
 * `RedisCartHoldStoreAdapter.hold` сам глотает ошибку соединения (JSDoc адаптера).
 */
import { Inject, Injectable } from '@nestjs/common'
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { ControlledSubstanceNotOrderableError, NotFoundError, ValidationError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import {
  CATALOG_FACADE_PORT,
  type CatalogFacadePort,
  type MedicineOrderSnapshot,
} from '../ports/catalog-facade.port.js'
import { CART_HOLD_STORE_PORT, type CartHoldStorePort } from '../ports/cart-hold-store.port.js'
import { CART_REPOSITORY, type CartItemRecord, type CartRepository } from './ports/cart.repository.port.js'
import { CART_WARNING_DUPLICATE_SUBSTANCE, type CartWarningEvent } from './events/cart-warning.event.js'

/** SRS-ORD-003: наркотики/психотропы не заказываются онлайн вообще, даже единицей. */
const CONTROLLED_CATEGORIES = new Set<string>(['psychotropic', 'narcotic'])

export interface AddCartItemInput {
  readonly tenantId: string
  readonly cartId: string
  readonly medicineId: string
  readonly pharmacyId: string
  readonly quantity: number
}

export interface AddCartItemResult {
  readonly item: CartItemRecord
  readonly warnings: readonly CartWarningEvent[]
}

export type AddCartItemError = ControlledSubstanceNotOrderableError

@Injectable()
export class AddCartItemUseCase {
  // eslint-disable-next-line max-params -- 3 порта + AppConfigService (DTJ-224 добавил CartHoldStorePort+config к DTJ-223). Тот же приём, что RequestOtpUseCase (auth/application/use-cases/request-otp.use-case.ts): явные @Inject-параметры сохраняют граф зависимостей видимым в providers[] модуля, а не скрывают его за фабрикой deps-объекта.
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepository: CartRepository,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes`
    // (DTJ-001, урок волны 5 §6.1 `reports/EP09-CTO-BRIEF.md`): без него параметр не
    // резолвится Nest'ом и `node dist/main.js` не стартует.
    @Inject(CATALOG_FACADE_PORT) private readonly catalogFacadePort: CatalogFacadePort,
    @Inject(CART_HOLD_STORE_PORT) private readonly cartHoldStore: CartHoldStorePort,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async execute(input: AddCartItemInput): Promise<Result<AddCartItemResult, AddCartItemError>> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new ValidationError('quantity must be a positive integer', { quantity: input.quantity })
    }

    const cart = await this.cartRepository.findById(input.tenantId, input.cartId)
    if (cart === null) {
      throw new NotFoundError({ resource: 'cart', cartId: input.cartId })
    }

    const snapshot = await this.resolveSnapshot(input.medicineId)
    if (CONTROLLED_CATEGORIES.has(snapshot.controlCategory)) {
      return err(
        new ControlledSubstanceNotOrderableError({
          medicineId: input.medicineId,
          controlCategory: snapshot.controlCategory,
        }),
      )
    }

    const warnings = await this.detectDuplicateSubstanceWarnings(input, snapshot.tradeName)
    const item = await this.cartRepository.upsertItem(input.tenantId, {
      cartId: input.cartId,
      medicineId: input.medicineId,
      pharmacyId: input.pharmacyId,
      quantityDelta: input.quantity,
    })
    if (item === null) {
      // Гонка: корзина существовала на шаге findById выше, но упсёрт в её тенант-скоуп не
      // попал (удалена/сменила владельца между вызовами) — та же NotFoundError, что и выше.
      throw new NotFoundError({ resource: 'cart', cartId: input.cartId })
    }
    await this.cartHoldStore.hold({
      pharmacyId: input.pharmacyId,
      medicineId: input.medicineId,
      cartItemId: item.id,
      quantity: item.quantity,
      ttlSeconds: this.config.cartHoldTtlSeconds,
    })
    return ok({ item, warnings })
  }

  /** `getMedicineSnapshot([medicineId])` — существование ИЛИ `NotFoundError`, снимок несёт `tradeName` (DTJ-234). */
  private async resolveSnapshot(medicineId: string): Promise<MedicineOrderSnapshot> {
    const snapshots = await this.catalogFacadePort.getMedicineSnapshot([medicineId])
    const snapshot = snapshots.get(medicineId)
    if (snapshot === undefined) {
      throw new NotFoundError({ resource: 'medicine', medicineId })
    }
    return snapshot
  }

  /**
   * SRS-ORD-004/SRS-DOM-175 — не блокирует, только предупреждает вызывающего.
   *
   * `input` (не 4 отдельных параметра — C5, `max-params` ≤3) — переиспользует уже собранный
   * `AddCartItemInput`, `newMedicineTradeName` — второй параметр, НЕ повторный
   * `getMedicineSnapshot` (уже резолвлен в `execute` через `resolveSnapshot`, переиспользуем).
   * `existingSnapshots` — ОДИН доп. batch-вызов на ВСЕ `otherMedicineIds` (то же правило
   * «ровно один вызов на группу», что и `getSubstanceSet` ниже, DoD DTJ-223 №4).
   */
  private async detectDuplicateSubstanceWarnings(
    input: AddCartItemInput,
    newMedicineTradeName: string,
  ): Promise<readonly CartWarningEvent[]> {
    const existingItems = await this.cartRepository.findItemsByCartId(input.tenantId, input.cartId)
    const otherMedicineIds = [
      ...new Set(existingItems.map((item) => item.medicineId).filter((id) => id !== input.medicineId)),
    ]
    if (otherMedicineIds.length === 0) {
      return []
    }

    const [substanceSets, existingSnapshots] = await Promise.all([
      this.catalogFacadePort.getSubstanceSet([input.medicineId, ...otherMedicineIds]),
      this.catalogFacadePort.getMedicineSnapshot(otherMedicineIds),
    ])
    const newSubstances = substanceSets.get(input.medicineId) ?? new Map<string, string>()
    const warnings: CartWarningEvent[] = []
    for (const existingMedicineId of otherMedicineIds) {
      const existingSubstances = substanceSets.get(existingMedicineId) ?? new Map<string, string>()
      const substanceNames = sharedSubstanceNames(newSubstances, existingSubstances)
      if (substanceNames.length === 0) {
        continue
      }
      warnings.push({
        type: CART_WARNING_DUPLICATE_SUBSTANCE,
        existingMedicineId,
        // ЗАПРЕЩЕНО подставлять existingMedicineId вместо имени (тот же приём, что pharmacyName
        // в GetCartUseCase) — null, если медикамент сняли с публикации после добавления в корзину.
        existingMedicineTradeName: existingSnapshots.get(existingMedicineId)?.tradeName ?? null,
        newMedicineId: input.medicineId,
        newMedicineTradeName,
        substanceNames,
      })
    }
    return warnings
  }
}

/** Названия веществ, присутствующих в ОБЕИХ картах (id → имя) — не просто факт пересечения. */
function sharedSubstanceNames(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): string[] {
  const names: string[] = []
  for (const [substanceId, name] of a) {
    if (b.has(substanceId)) names.push(name)
  }
  return names
}
