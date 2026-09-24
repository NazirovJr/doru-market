// Прямой импорт modules/analytics/domain|application|infrastructure из другого модуля запрещён — только через этот барабан.
//
// Отклонение от общего правила «analytics — subscriber-only через outbox»: AnalyticsFacade.recordEvent
// принимает синхронную запись от других модулей, не только читает outbox. Специфицировано SRS-ADM-067
// (product_events копит и чисто UX-телеметрию без доменного смысла, для которой outbox-событие
// было бы искусственным) — до отдельного ADR архитектора реализация следует этому источнику дословно.
export { AnalyticsModule } from './analytics.module.js'
export { AnalyticsFacade } from './analytics.facade.js'
export type { RecordProductEventCommand } from './application/use-cases/record-product-event.use-case.js'
