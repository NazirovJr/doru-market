/**
 * `RetryPaymentUseCase` (EP-10, DTJ-241, SRS-PAY-041) — `POST /api/v1/orders/:id/retry-payment`:
 * заказ существует в `pending_payment` БЕЗ `payment_transaction_id` (предыдущая попытка
 * `PaymentInvoicePort.createInvoice()` упала ПОСЛЕ commit заказа, D-EP09-17) — повторяет
 * попытку С НОВЫМ `idempotencyKey` («Что сделать» п.3 тикета: «НЕ переиспользующий
 * провалившийся» — тот уже помечен `status='pending'`/`failed` в `payment_operations` и не
 * должен блокировать повтор).
 *
 * **Живёт в `orders`, а НЕ в `payments` — отклонение от буквального `files_owned` тикета
 * DTJ-241, обоснование в DISPUTED отчёта сдачи и JSDoc `payments.module.ts`/`orders.module.ts`
 * (блок про `RetryPaymentUseCase`/`no-circular`).** Кратко: буквальное размещение в `payments`
 * потребовало бы читать заказ через `OrdersFacade` (`orders`), а `orders` УЖЕ зависит от
 * `payments` (`PAYMENT_INVOICE_PORT`) — получилась бы циклическая зависимость МОДУЛЕЙ на
 * уровне статических ES-импортов, которую `pnpm arch:check` (dependency-cruiser, встроенное
 * правило `no-circular`) отклоняет как ошибку. Здесь вызывается УЖЕ существующий
 * `PAYMENT_INVOICE_PORT` (тот же порт, что `CheckoutUseCase`) — граф остаётся однонаправленным.
 *
 * Использует `OrdersFacade`/`Order` НАПРЯМУЮ (тот же модуль, `CancelOrderUseCase`-паттерн) —
 * НЕ через публичный фасад `orders/index.ts` (тот фасад — для ЧУЖИХ модулей, `02` §1.2).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import {
  PAYMENT_INVOICE_PORT,
  type PaymentInvoicePort,
  type InvoiceRef,
} from '@/modules/orders/application/ports/payment-invoice.port.js'
import type { Order } from '@/modules/orders/domain/order.entity.js'
import { OrderNotRetryableError } from './errors/order-not-retryable.error.js'

export interface RetryPaymentCommand {
  readonly tenantId: string
  readonly orderId: string
  readonly customerId: string
  readonly customerPhone: string
  /** Новый, ранее не использованный ключ (см. JSDoc файла) — обычно = HTTP `Idempotency-Key`. */
  readonly idempotencyKey: string
}

@Injectable()
export class RetryPaymentUseCase {
  constructor(
    @Inject(OrdersFacade) private readonly ordersFacade: OrdersFacade,
    @Inject(PAYMENT_INVOICE_PORT) private readonly paymentInvoice: PaymentInvoicePort,
  ) {}

  async execute(cmd: RetryPaymentCommand): Promise<InvoiceRef> {
    const order = await this.findAuthorizedOrder(cmd)
    this.assertRetryable(order)
    const result = await this.paymentInvoice.createInvoice({
      orderId: order.id,
      amountDiram: order.totalAmount.diram,
      currency: 'TJS',
      idempotencyKey: cmd.idempotencyKey,
      description: `DoruTJ order ${order.orderNumber.value}`,
      customerPhone: cmd.customerPhone,
    })
    if (!result.ok) {
      throw new Error(`retry-payment: PaymentInvoicePort.createInvoice failed — ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  /** Тенант-скоуп + ownership — тот же приём, что `CancelOrderUseCase.findAuthorizedOrder` (SRS-API-043/046). */
  private async findAuthorizedOrder(cmd: RetryPaymentCommand): Promise<Order> {
    const order = await this.ordersFacade.getOrderById(cmd.tenantId, cmd.orderId)
    if (order?.tenantId !== cmd.tenantId) {
      // Чужой тенант неотличим от несуществующего заказа снаружи (SRS-API-046).
      throw new NotFoundError({ resource: 'order', orderId: cmd.orderId })
    }
    if (order.customerId !== cmd.customerId) {
      throw new ForbiddenError('Order does not belong to the requesting customer', { orderId: cmd.orderId })
    }
    return order
  }

  /** AC3/AC4 тикета: retryable ⟺ `pending_payment` БЕЗ `payment_transaction_id` (SRS-PAY-041). */
  private assertRetryable(order: Order): void {
    const isRetryable = order.status === 'pending_payment' && order.toSnapshot().paymentTransactionId === null
    if (!isRetryable) {
      throw new OrderNotRetryableError({ orderId: order.id, status: order.status })
    }
  }
}
