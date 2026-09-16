/**
 * Форма payload очереди `partial-fulfillment-timeout` (EP-12, DTJ-304). СВОЯ копия типа,
 * объявленного в `apps/api/src/modules/orders/infrastructure/jobs/
 * partial-fulfillment-timeout.processor.ts` (`PartialFulfillmentTimeoutJobData`) — apps/worker
 * не может импортировать код apps/api (отдельные TS-проекты монорепо, разные `tsconfig.json`,
 * тот же класс дублирования, что `mock-bank-auto-pay.types.ts`, EP-10). Изменение формы в ОДНОМ
 * файле ОБЯЗАНО быть отражено в другом вручную.
 */
export interface PartialFulfillmentTimeoutJobData {
  readonly requestId: string
  readonly tenantId: string
}
