/**
 * Форма payload очереди `mock-bank-auto-pay` (EP-10, DTJ-238). СВОЯ копия типа, объявленного в
 * `apps/api/src/modules/payments/infrastructure/adapters/mock-bank.provider.ts` — apps/worker
 * не может импортировать код apps/api (отдельные TS-проекты монорепо, разные `tsconfig.json`).
 * Изменение формы в ОДНОМ файле ОБЯЗАНО быть отражено в другом вручную — задокументированная,
 * неизбежная дублировка на границе процессов (BullMQ+Redis — единственный канал связи).
 */
export interface MockBankAutoPayJobData {
  readonly bankEventId: string
  readonly providerRef: string
  readonly type: 'payment_confirmed' | 'payment_failed' | 'refund_confirmed' | 'refund_failed'
  readonly amountDiram: string
}
