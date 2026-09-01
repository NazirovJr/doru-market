/**
 * `ChainNotWhitelabelRequestedError` — попытка провизионировать тенанта для сети, у
 * которой `is_whitelabel_requested = false` (DTJ-057 сценарий проверки). HTTP 409
 * `CONFLICT`, отдельный класс для `409 TENANT_*`-ветки (не валидация формы запроса,
 * а семантическое несоответствие состояния сети).
 */
import { ConflictError } from '@dorutj/contracts'

export class ChainNotWhitelabelRequestedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super(
      'Chain has not requested whitelabel',
      { ...(details ?? {}), reason: 'chain_not_whitelabel_requested' },
    )
  }
}
