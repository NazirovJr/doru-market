/**
 * `ChainApplicationAlreadyExistsError` (SRS-ADM-007): попытка
 * `SubmitChainApplicationUseCase` с `tinInn`, который уже существует
 * в `pharmacy_chains` в ЛЮБОМ статусе кроме `rejected` (для `rejected`
 * — DTJ-064 п.3 переиспользует запись).
 *
 * HTTP 409 через канонический код `CHAIN_APPLICATION_ALREADY_EXISTS`.
 */
import { ConflictError, ErrorCode } from '@dorutj/contracts'

export class ChainApplicationAlreadyExistsError extends ConflictError {
  constructor(tinInn: string, currentStatus: string) {
    super(
      'Application with this TIN/INN already exists',
      { tinInn, currentStatus },
      ErrorCode.CHAIN_APPLICATION_ALREADY_EXISTS,
    )
  }
}
