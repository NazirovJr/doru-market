// Порт DTJ-385: сервер-авторитетная экономия analog_shown/added_to_cart — клиентский
// savingsDiram больше не источник истины. Реализация делегирует на `CatalogFacade`.
export interface AnalogSavingsComputeInput {
  readonly tenantId: string
  readonly referenceMedicineId: string
  readonly analogMedicineId: string
  readonly pharmacyId?: string
}

export interface AnalogSavingsPort {
  compute(input: AnalogSavingsComputeInput): Promise<bigint | null>
}

export const ANALOG_SAVINGS_PORT = Symbol.for('@dorutj/analytics/analog-savings-port')
