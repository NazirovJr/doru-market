/**
 * `SensitiveMetadataFieldError` (EP-16, DTJ-374, SRS-ADM-063/064) — `AuditEntry.create()`
 * получил `metadata` (`before`/`after`/`extra`), содержащую запрещённое поле (см.
 * `SENSITIVE_METADATA_FIELDS`, `audit-entry.ts`).
 *
 * Секрет не должен попасть в неизменяемый `audit_log` ни при каких обстоятельствах —
 * конструктор отклоняет запись целиком, а не молча вырезает поле: молчаливое вырезание
 * маскировало бы ошибку вызывающего кода (например, передачу ПОЛНОГО снепшота сущности вместо
 * только изменившихся полей, SRS-ADM-063), которую стоит увидеть на этапе разработки/теста,
 * а не в проде через полгода при комплаенс-выгрузке.
 *
 * Локальное определение (не `packages/contracts`) — тот же приём, что
 * `modules/payments/domain/errors/adjustment-requires-reason.error.ts`: `domain/` этого
 * сквозного сервиса не зависит от общего каталога ошибок EP-01, остаётся переносимым без
 * инфраструктуры.
 */
const SENSITIVE_METADATA_FIELD_CODE = 'AUDIT_LOG_SENSITIVE_METADATA_FIELD'

export class SensitiveMetadataFieldError extends Error {
  public readonly code = SENSITIVE_METADATA_FIELD_CODE

  public constructor(public readonly fieldName: string) {
    super(
      `AuditEntry.metadata contains forbidden field "${fieldName}" (SRS-ADM-063) — secrets must never enter audit_log`,
    )
    this.name = new.target.name
  }
}
