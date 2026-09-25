// excludedCategory/cutoff — явные параметры вызова, не константы адаптера: делает исключение
// категории проверяемым юнит-тестом job'а, а не деталью SQL.
export interface AuditLogRetentionCriteria {
  readonly cutoff: Date
  readonly excludedCategory: string
  readonly batchSize: number
}

export interface AuditLogRetentionPort {
  deleteBatch(criteria: AuditLogRetentionCriteria): Promise<number>
}
