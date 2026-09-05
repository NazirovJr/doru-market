/**
 * Ядро джобы `payout-scheduler` (EP-10, DTJ-249, SRS-DOM-103/058/105, SRS-PAY-030/032,
 * `21-module-orders-payments-escrow.md`) — единственный переход `payout_schedule.status`,
 * управляемый временем, а не действием пользователя (D-19, осознанное архитектурное решение).
 *
 * Один батчевый `UPDATE ... WHERE status='pending' AND EXISTS (...)` покрывает ВЕСЬ тик
 * атомарно на уровне БД (буквальный текст тикета «Что сделать» п.1) — НЕ построчный цикл, в
 * отличие от `EscrowReconciliationJob`/`UnpaidOrderTimeoutJob` (те делают действие ЗА КАЖДУЮ
 * строку — HTTP-вызов/support-ticket; здесь единственное действие — сама мутация статуса,
 * которую Postgres уже умеет делать батчем одним запросом).
 *
 * Изоляция от `disputed`-строк — САМИМ значением `status` в `WHERE status='pending'`
 * (SRS-PAY-032, «простота как гарантия» — см. JSDoc адаптера) — без дополнительного
 * `WHERE status != 'disputed'`, которое легко забыть при рефакторинге.
 *
 * `apps/worker` не может использовать `PayoutScheduleRepository`/Drizzle-схему `apps/api`
 * (нет пути импорта между `apps/*`, см. JSDoc `escrow-reconciliation.job.ts`) — `now`
 * параметризован ОДНИМ значением на оба употребления (`due_at`/сравнение с `delivered_at +
 * hold_period_days`) вместо литерального `NOW()` дважды из текста тикета — детерминированный
 * снэпшот времени, тестируемый инъекцией `now`, тот же приём, что `findExpiredOrders(now)`/
 * `findImbalancedOrders(since)` у сестёр-джоб.
 */
import { Inject, Injectable, Logger } from '@nestjs/common'

export const PAYOUT_SCHEDULER_PORT = Symbol.for('@dorutj/worker/payout-scheduler-port')

export interface PayoutSchedulerPort {
  /**
   * `UPDATE payout_schedule SET status='due', due_at=:now WHERE status='pending' AND EXISTS
   * (SELECT 1 FROM orders WHERE orders.id=payout_schedule.order_id AND orders.delivered_at +
   * (payout_schedule.hold_period_days || ' days')::interval <= :now)` — снэпшот
   * `hold_period_days` из строки `payout_schedule` (записан DTJ-244), не текущий
   * `tenant_settings`. Возвращает число затронутых строк.
   */
  markDueBatch(now: Date): Promise<number>
}

export interface PayoutSchedulerResult {
  readonly movedToDue: number
}

@Injectable()
export class PayoutSchedulerJob {
  private readonly logger = new Logger(PayoutSchedulerJob.name)

  constructor(@Inject(PAYOUT_SCHEDULER_PORT) private readonly port: PayoutSchedulerPort) {}

  /** Один тик: один батчевый `UPDATE`, ничего не сканирует построчно (см. JSDoc файла). */
  async runOnce(now: Date = new Date()): Promise<PayoutSchedulerResult> {
    const movedToDue = await this.port.markDueBatch(now)
    this.logger.log(`payout-scheduler: тик выполнен — переведено в due ${String(movedToDue)}`)
    return { movedToDue }
  }
}
