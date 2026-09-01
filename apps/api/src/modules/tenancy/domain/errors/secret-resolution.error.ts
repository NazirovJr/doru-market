/**
 * `SecretResolutionError` — `SecretsVaultPort.resolve()` (DTJ-058) не смог получить
 * секрет (нет ENV, сбой Vault и т.п.). HTTP 503, ближайший к `PaymentProviderUnavailableError`
 * по семантике «внешний сервис временно недоступен» (но каталог ошибок в
 * `10-domain-model.md` не выделяет специального кода под секрет-стор, поэтому
 * используем `SERVICE_UNAVAILABLE`).
 */
import { DomainError, ErrorCode } from '@dorutj/contracts'

export class SecretResolutionError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.SERVICE_UNAVAILABLE, 'Secret could not be resolved', details)
  }
}
