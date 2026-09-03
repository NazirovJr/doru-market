/**
 * `EscrowLedgerImbalanceMetric` (EP-10, DTJ-247, SRS-PAY-014) — минимальный in-memory
 * Prometheus-совместимый counter для `escrow_ledger_imbalance_count`, инкрементируемый на
 * каждое расхождение, обнаруженное `EscrowReconciliationJob` (SRS-PAY-013).
 *
 * ГРАНИЦА ПРОЦЕССА (важно прочитать перед использованием, см. отчёт сдачи DTJ-247, DISPUTED):
 * `EscrowReconciliationJob` физически исполняется в `apps/worker` — ОТДЕЛЬНОМ Node-процессе,
 * СВОЁМ package.json (`apps/worker/package.json` НЕ зависит от `@dorutj/api`, проверено:
 * никакого пути импорта из `apps/worker` в `apps/api` не существует физически). Экземпляр ЭТОГО
 * класса, живущий в процессе `apps/api`, НЕ инкрементируется джобой напрямую — инкремент
 * происходит на РЕАЛЬНОМ, ОТДЕЛЬНОМ экземпляре этого же примитива внутри `apps/worker`
 * (`apps/worker/src/jobs/payout/escrow-ledger-imbalance.metric.ts`, НАМЕРЕННО отдельный файл —
 * не дублирование ради лени, а единственный физически возможный вариант при раздельных
 * деплоях: у КАЖДОГО Prometheus-совместимого процесса СВОЙ registry в реальной инфраструктуре
 * наблюдаемости, это не анти-паттерн, а нормальная модель "один процесс — один /metrics").
 *
 * Класс здесь (буквальный `files_owned` тикета, путь `payments/infrastructure/metrics/...`)
 * существует как переиспользуемый, framework-agnostic примитив — для БУДУЩЕГО api-side
 * потребителя (например, эндпоинт, агрегирующий метрики нескольких процессов, или локальный
 * счётчик расхождений, найденных СИНХРОННО через `GetOrderLedgerQuery.meta.isBalanced`, DTJ-248
 * — на момент ЭТОГО тикета такого вызывающего кода ещё нет, не забиндено ни в один модуль
 * намеренно, см. правило 4 задания: пустой, но синтаксически валидный/протестированный класс —
 * не то же самое, что «написанный, но неподключённый use case», код без побочных эффектов до
 * первого потребителя безопасен, тот же приём, что `PaymentsFacade`/`PAYMENTS_FACADE` в
 * `payments/index.ts`, DTJ-236).
 *
 * `exportEnabled` (ENV-флаг экспорта, буквальное требование тикета): у ЭТОГО процесса
 * (`apps/api`) пока нет HTTP `/metrics`-поверхности вообще (не заведена ни одним эпиком) —
 * `toPrometheusText()` возвращает готовую строку exposition format, ГОТОВУЮ подключить к
 * будущему `GET /metrics`, но сам эндпоинт — TODO(EP-observability, не тикетирован).
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

  /** `null`, если экспорт выключен ENV-флагом (см. JSDoc файла) — вызывающий код решает, что делать с `null`. */
  public toPrometheusText(): string | null {
    if (!this.exportEnabled) return null
    return `# HELP ${PROMETHEUS_METRIC_NAME} ${PROMETHEUS_METRIC_HELP}\n# TYPE ${PROMETHEUS_METRIC_NAME} counter\n${PROMETHEUS_METRIC_NAME} ${String(this.count)}\n`
  }
}
