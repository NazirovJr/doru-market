/**
 * `RefundFacadeAdapter` (EP-10, DTJ-245) — реализация `RefundFacadePort`, объявленного
 * `orders`-модулем (DTJ-232, EP-09, ре-экспортирован `orders/index.js` — межмодульный биндинг
 * через порт, не прямой импорт домена `orders`, `02` §1.2) — тот же паттерн, что
 * `PaymentInvoiceAdapter` (DTJ-241, `payment-invoice.adapter.ts`): импортирует ТОЛЬКО
 * `@/modules/orders/index.js` (публичный фасад), никогда `orders/application|domain/**`
 * напрямую. Тонкая обёртка над `RefundOrderUseCase` (тот же тикет) — вся логика (включая
 * реальную конкурентность, см. её JSDoc) живёт ТАМ, этот файл только резолвит `tenantId` и
 * маппирует ошибки под контракт `RefundFacadePort`.
 *
 * **`tenantId` — контракт `RefundFacadePort.refundFull(orderId, reason)` его не несёт**
 * (сигнатура зафиксирована DTJ-232/EP-09, порт заморожен — «Риски» DTJ-245 предписывают
 * сверить, не менять). `RefundOrderUseCase`/`PaymentsOrdersPort`/`EscrowLedgerRepository`
 * требуют `tenantId` первым параметром (SRS-API-043/046) — резолвится ЗДЕСЬ, в infrastructure,
 * прямым чтением `orders.tenant_id` (тот же приём, что `DrizzleEscrowLedgerRepository.
 * orderBelongsToTenant`/`OrdersFacadeAdapter.getOrderByIdLocking`, DTJ-240/242: чтение чужой
 * Drizzle-СХЕМЫ из своего `infrastructure` — не межмодульный deep-import, запрещён только
 * импорт `domain`/`application` чужого модуля, `02` §1.1). Единственный вызывающий код
 * (`CancelOrderUseCase`) уже проверил тенант-принадлежность заказа ДО вызова `refundFull` —
 * отсутствующая строка здесь (invariant violation, не 404: сравнимо с D-EP09-35) означает
 * программную ошибку вызывающего кода, не чужой тенант.
 *
 * **НЕТ транзакции/блокировки вокруг `RefundOrderUseCase.execute()`.** Первая версия этого
 * файла открывала `db.transaction(...)` с `pg_advisory_xact_lock`/`SELECT ... FOR UPDATE` —
 * живой прогон `Promise.all` (10 конкурентных `refundFull()`) воспроизвёл исчерпание пула
 * соединений (транзакция держала соединение через вызов `PaymentProvider.refund()`, который
 * САМ независимо обращается к БД через тот же пул — тот же класс тупика, что описан в задании
 * раздел «Жёсткие правила» п.2). Реальная конкурентность теперь защищена НА УРОВНЕ БД
 * (частичный уникальный индекс `ux_escrow_ledger_refunded_once`, миграция
 * `0035_escrow_ledger_refund_unique.sql`) — см. JSDoc `refund-order.use-case.ts` «Решение —
 * частичный уникальный индекс». Этот файл больше не открывает транзакцию вообще (правило 2
 * задания: «нужна атомарность — прокидывай tx; не нужна — не открывай транзакцию» — здесь
 * атомарность обеспечивает констрейнт БД, не транзакция уровня приложения).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import type { Result } from '@dorutj/domain-kernel'
import { ErrorCode } from '@dorutj/contracts'
import {
  REFUND_FACADE_PORT,
  type RefundFacadePort,
  type RefundError,
  type OrderCancelReason,
  type PartialFulfillmentRefundCommand,
} from '@/modules/orders/index.js'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { orders } from '@/db/schema/orders.js'
import { RefundOrderUseCase } from '@/modules/payments/application/use-cases/refund-order.use-case.js'
import { PartiallyRefundOrderUseCase } from '@/modules/payments/application/use-cases/partially-refund-order.use-case.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'

export { REFUND_FACADE_PORT }

const TIMEOUT_PROVIDER_ERROR_CODE = 'TIMEOUT'

@Injectable()
export class RefundFacadeAdapter implements RefundFacadePort {
  public constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(RefundOrderUseCase) private readonly refundOrderUseCase: RefundOrderUseCase,
    // DTJ-304 — см. JSDoc `refundPartialFulfillment` ниже.
    @Inject(PartiallyRefundOrderUseCase) private readonly partiallyRefundOrderUseCase: PartiallyRefundOrderUseCase,
  ) {}

  public async refundFull(orderId: string, reason: OrderCancelReason): Promise<Result<void, RefundError>> {
    try {
      const tenantId = await this.resolveTenantId(orderId)
      await this.refundOrderUseCase.execute({ tenantId, orderId, reason })
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, error: toRefundError(error) }
    }
  }

  /** ДОБАВЛЕНО (DTJ-304) — см. JSDoc `PartialFulfillmentRefundCommand` (`orders/application/ports/
   *  refund-facade.port.ts`) и `PartiallyRefundOrderUseCase`. Тонкая обёртка, 1:1 приём `refundFull` выше. */
  public async refundPartialFulfillment(command: PartialFulfillmentRefundCommand): Promise<Result<void, RefundError>> {
    try {
      const tenantId = await this.resolveTenantId(command.orderId)
      await this.partiallyRefundOrderUseCase.execute({
        tenantId,
        orderId: command.orderId,
        refundAmountDiram: command.refundAmountDiram,
      })
      return { ok: true, value: undefined }
    } catch (error) {
      return { ok: false, error: toRefundError(error) }
    }
  }

  private async resolveTenantId(orderId: string): Promise<string> {
    const rows = await this.db.select({ tenantId: orders.tenantId }).from(orders).where(eq(orders.id, orderId)).limit(1)
    const tenantId = rows[0]?.tenantId
    if (tenantId === undefined) {
      throw new Error(
        `RefundFacadeAdapter: order ${orderId} not found — invariant violation (caller must validate existence before calling refundFull()).`,
      )
    }
    return tenantId
  }
}

/** Тот же приём, что `PaymentInvoiceAdapter.toPaymentInvoiceError` (DTJ-241). */
function toRefundError(error: unknown): RefundError {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof PaymentProviderError && error.code === TIMEOUT_PROVIDER_ERROR_CODE) {
    return { code: ErrorCode.SERVICE_UNAVAILABLE, message }
  }
  return { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message }
}
