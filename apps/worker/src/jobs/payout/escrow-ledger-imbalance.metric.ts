/**
 * `EscrowLedgerImbalanceMetric` (EP-10, DTJ-247, SRS-PAY-014) — РЕАЛЬНЫЙ, инкрементируемый
 * экземпляр примитива, живущий в процессе `apps/worker`, где физически исполняется
 * `EscrowReconciliationJob`. Копия (не импорт) `apps/api/src/modules/payments/infrastructure/
 * metrics/escrow-ledger-imbalance.metric.ts` — `apps/worker` НЕ зависит от `@dorutj/api`
 * (проверено: `apps/worker/package.json` не содержит такой зависимости, путей импорта между
 * `apps/*` в этой монорепе не существует физически, только через `packages/*`) — см. JSDoc
 * api-side копии про модель «один процесс — один Prometheus registry» и полное обоснование в
 * отчёте сдачи DTJ-247, раздел DISPUTED.
 */
const PROMETHEUS_METRIC_NAME = 'escrow_ledger_imbalance_count'
const PROMETHEUS_METRIC_HELP = 'Total number of escrow ledger orders found imbalanced by EscrowReconciliationJob'

export class EscrowLedgerImbalanceMetric {
  private count = 0

  public constructor(private readonly exportEnabled: boolean) {}

  /** Инкрементируется РОВНО один раз за КАЖДЫЙ order_id, найденный несбалансированным за тик. */
  public increment(): void {
    this.count += 1
  }

  public get value(): number {
    return this.count
  }

  /** `null`, если экспорт выключен ENV-флагом — вызывающий код решает, что делать с `null`. */
  public toPrometheusText(): string | null {
    if (!this.exportEnabled) return null
    return `# HELP ${PROMETHEUS_METRIC_NAME} ${PROMETHEUS_METRIC_HELP}\n# TYPE ${PROMETHEUS_METRIC_NAME} counter\n${PROMETHEUS_METRIC_NAME} ${String(this.count)}\n`
  }
}
