/**
 * `ScanOrderItemUseCase` (DTJ-302, EP-12, модуль 24 §A.3, SRS-PHT-011..016) — сканирование
 * позиции заказа терминалом фармацевта, `POST /api/v1/orders/:id/items/:itemId/scan`.
 *
 * Оркестрирует пайплайн валидации из шести шагов (SRS-PHT-011..016), сам НЕ принимает решений —
 * решения делегированы доменным ошибкам/методам (`OrderItem.assertPending`/`markScannedOk`/
 * `substituteBatch`, `ExpiryDate.isSellable` внутри `InventoryFacadeAdapter`). Шаг «а»
 * (`Barcode.parse`, разбор формата EAN-13/internal_sku) НЕ вызывается здесь напрямую —
 * инкапсулирован в `CatalogFacadePort.resolveMedicineIdByBarcode` (см. его JSDoc): use case не
 * обязан знать, КАК разрешился штрихкод, только результат (`medicineId | null`) — тот же приём,
 * что `resolveMedicineByComposite` (реальный, DTJ-097) тоже прячет разбор формата ВНУТРИ своего
 * use case, не в вызывающем коде. `TC-PHT-028` (internal_sku-путь, резолвится в верный
 * `medicineId`) проверяется на уровне ЭТОГО use case через мок `CatalogFacadePort` — деталь
 * реализации порта не важна для теста пайплайна.
 *
 * Вся операция — ОДНА транзакция БД (`OrdersUnitOfWorkPort.run`, тот же приём, что
 * `CheckoutUseCase`): загрузка заказа, резерв новой партии, освобождение старой, сохранение
 * позиции — атомарны (TC-PHT-006: провал на шаге проверки партии откатывает ВСЁ, включая
 * гипотетическую частичную мутацию). Порядок вызовов `InventoryFacade` внутри
 * `applyBatchSubstitutionIfRequested` — РЕЗЕРВ новой партии ПЕРЕД освобождением старой
 * (безопаснее буквального порядка из текста тикета, см. JSDoc `InventoryFacadePort.reserveForOrder`).
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  BatchNotAvailableForSubstitutionError,
  ErrorCode,
  ExpiredStockError,
  ForbiddenError,
  ItemNotInOrderError,
  NotFoundError,
  type OrderItemDto,
  type UserRole,
} from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderItem } from '@/modules/orders/domain/order-item.entity.js'
import { toOrderItemDto } from '@/modules/orders/domain/order.mapper.js'
import { OrderPolicy } from '@/modules/orders/application/policies/order.policy.js'
import {
  ORDER_REPOSITORY_PORT,
  type OrderRepositoryPort,
  type OrderUnitOfWorkTx,
} from '@/modules/orders/application/ports/order-repository.port.js'
import { ORDERS_UNIT_OF_WORK, type OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import { CATALOG_FACADE_PORT, type CatalogFacadePort } from '@/modules/orders/application/ports/catalog-facade.port.js'
import {
  INVENTORY_FACADE_PORT,
  type BatchSubstitutionError,
  type InventoryFacadePort,
} from '@/modules/orders/application/ports/inventory-facade.port.js'

export interface ScanOrderItemActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string
  /** `null` для ролей вне `pharmacist`/`pharmacy_admin` — `OrderPolicy.canManagePicking` отвергнет их. */
  readonly pharmacyId: string | null
}

export interface ScanOrderItemCommand {
  readonly orderId: string
  readonly itemId: string
  readonly rawBarcode: string
  readonly manualEntry: boolean
  /** `null` — валидация партии пропускается (SRS-PHT-011), используется исходный FEFO-резерв. */
  readonly scannedBatchNumber: string | null
  readonly actor: ScanOrderItemActor
}

@Injectable()
export class ScanOrderItemUseCase {
  // eslint-disable-next-line max-params -- 5 портов (Order repo/UnitOfWork/Catalog/Inventory + Clock) — тот же приём, что CancelOrderUseCase (явные @Inject, esbuild/vitest не эмитит design:paramtypes, DTJ-001).
  constructor(
    @Inject(ORDER_REPOSITORY_PORT) private readonly orderRepository: OrderRepositoryPort,
    @Inject(ORDERS_UNIT_OF_WORK) private readonly unitOfWork: OrdersUnitOfWorkPort,
    @Inject(CATALOG_FACADE_PORT) private readonly catalogFacade: CatalogFacadePort,
    @Inject(INVENTORY_FACADE_PORT) private readonly inventoryFacade: InventoryFacadePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(cmd: ScanOrderItemCommand): Promise<OrderItemDto> {
    return this.unitOfWork.run(async (tx) => {
      const loaded = await this.loadAuthorizedItem(cmd, tx)
      const { order, item } = loaded
      await this.assertBarcodeMatchesItem(cmd, order, item)
      item.assertPending()
      await this.applyBatchSubstitutionIfRequested(cmd, loaded, tx)
      item.markScannedOk({
        scannedAt: this.clock.now(),
        scannedBy: cmd.actor.userId,
        scanMethod: cmd.manualEntry ? 'manual' : 'camera',
      })
      await this.orderRepository.save(order, tx)
      return toOrderItemDto(item, order.id)
    })
  }

  /** Загрузка + тенант-скоуп + `OrderPolicy` + позиция — единая точка проверки доступа. */
  private async loadAuthorizedItem(
    cmd: ScanOrderItemCommand,
    tx: OrderUnitOfWorkTx,
  ): Promise<{ readonly order: Order; readonly item: OrderItem }> {
    const order = await this.orderRepository.findById(cmd.actor.tenantId, cmd.orderId, tx)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (!OrderPolicy.canManagePicking(order, cmd.actor)) {
      throw new ForbiddenError('This order cannot be managed by this actor', { orderId: cmd.orderId })
    }
    const item = order.items.find((candidate) => candidate.id === cmd.itemId)
    if (item === undefined) {
      throw new NotFoundError({ resource: 'orderItem', orderId: cmd.orderId, itemId: cmd.itemId })
    }
    return { order, item }
  }

  /** Пайплайн-шаги а-в (SRS-PHT-011/012) — см. JSDoc файла про разбор формата штрихкода. */
  private async assertBarcodeMatchesItem(cmd: ScanOrderItemCommand, order: Order, item: OrderItem): Promise<void> {
    const resolvedMedicineId = await this.catalogFacade.resolveMedicineIdByBarcode(order.pharmacyId, cmd.rawBarcode)
    if (resolvedMedicineId !== item.medicineId) {
      throw new ItemNotInOrderError({ orderId: cmd.orderId, itemId: cmd.itemId })
    }
  }

  /**
   * Пайплайн-шаг д (SRS-PHT-014). РЕЗЕРВ новой партии ВСЕГДА ПЕРЕД освобождением старой —
   * если новая невалидна, старая остаётся нетронутой (TC-PHT-006). Освобождение старой партии
   * выполняется ПОСЛЕ успешного резерва БЕЗУСЛОВНО (даже если резолвленный `batchId` совпал со
   * старым — редкий случай повторного ввода того же номера серии): `reserveForOrder` уже списал
   * `item.quantity` с этой же строки, `releaseStock` возвращает его обратно — арифметика верна
   * независимо от того, совпали партии или нет; `OrderItem.substituteBatch` вызывается, только
   * если партия РЕАЛЬНО изменилась (excess-write не нужен на самой сущности).
   */
  private async applyBatchSubstitutionIfRequested(
    cmd: ScanOrderItemCommand,
    loaded: { readonly order: Order; readonly item: OrderItem },
    tx: OrderUnitOfWorkTx,
  ): Promise<void> {
    if (cmd.scannedBatchNumber === null) {
      return
    }
    const { order, item } = loaded
    const reserved = await this.inventoryFacade.reserveForOrder(
      order.pharmacyId,
      item.medicineId,
      cmd.scannedBatchNumber,
      item.quantity,
      tx,
    )
    if (!reserved.ok) {
      throw toBatchSubstitutionDomainError(reserved.error)
    }
    await this.inventoryFacade.releaseStock([{ inventoryBatchId: item.inventoryBatchId, quantity: item.quantity }], tx)
    if (reserved.value.batchId !== item.inventoryBatchId) {
      item.substituteBatch(reserved.value.batchId)
    }
  }
}

function toBatchSubstitutionDomainError(error: BatchSubstitutionError): Error {
  return error.code === ErrorCode.EXPIRED_STOCK ? new ExpiredStockError() : new BatchNotAvailableForSubstitutionError()
}
