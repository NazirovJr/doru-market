// admin не имеет domain/ — подкласс DomainError живёт в application/errors/ (приём modules/catalog).
import { DomainError, ErrorCode } from '@dorutj/contracts'

export class CrossChainAccessDeniedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.CROSS_TENANT_ACCESS_DENIED, message, details)
  }
}
