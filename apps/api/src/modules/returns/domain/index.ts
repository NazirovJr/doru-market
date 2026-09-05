/**
 * Внутренний баррель `domain/` модуля `returns` (EP-11, DTJ-271).
 *
 * НЕ путать с публичным фасадом `modules/returns/index.ts` (DTJ-270) — тот НЕ реэкспортирует
 * `domain` наружу модуля (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2, «межмодульно — только через
 * фасад»). Этот файл используется ТОЛЬКО внутри `returns` — `application`/`infrastructure`
 * своего же модуля импортируют отсюда (`./domain/index.js`), а не по глубоким путям к
 * отдельным файлам.
 */
export {
  OrderReturn,
  type OrderReturnRequestCommand,
  type OrderReturnSnapshot,
  type ConfirmReceivedChecklist,
  type ConfirmReceivedCommand,
  type ReturnRestockEligibility,
} from './order-return.entity.js'
export { ReturnReason } from './value-objects/return-reason.vo.js'
export { ReturnDisposition } from './value-objects/return-disposition.vo.js'
export { RETURN_ALLOWED_TRANSITIONS, isReturnTransitionAllowed } from './order-return.state-machine.js'
export { DuplicateActiveReturnError } from './errors/duplicate-active-return.error.js'
export { RestockConditionsNotMetError } from './errors/restock-conditions-not-met.error.js'
export { ControlledSubstanceMustBeDestroyedError } from './errors/controlled-substance-must-be-destroyed.error.js'
export { InvalidReturnStatusTransitionError } from './errors/invalid-return-status-transition.error.js'
export { UnsupportedReturnReasonError } from './errors/unsupported-return-reason.error.js'
