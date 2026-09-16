import type { ControlCategoryPublic } from '@dorutj/contracts'

/**
 * `ReturnChecklistForm.model.ts` (DTJ-277, EP-11, SRS-DOM-053/054) — чистые функции чек-листа
 * приёмки возврата, вынесенные из `ReturnChecklistForm.tsx` (`02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §5: бизнес-логика — в `model/`, не в компоненте).
 *
 * `controlCategory` — расширение `OrderReturnDto` (`packages/contracts/src/returns.ts`, DTJ-277
 * п.4 задачи): опциональное поле, `undefined` трактуется как «неизвестно/не подконтрольно» (тот
 * же результат, что `'none'`) — консервативно НЕ блокирует переключатель, чтобы отсутствие поля
 * на старом бэкенде не превращалось в ложную блокировку restock для обычного товара.
 */

const UNRESTRICTED_CONTROL_CATEGORY: ControlCategoryPublic = 'none'

export interface ReturnChecklistState {
  readonly packagingIntact: boolean
  readonly notes: string
}

export const INITIAL_CHECKLIST_STATE: ReturnChecklistState = { packagingIntact: true, notes: '' }

export interface PackagingToggleState {
  /** `true` — переключатель визуально заблокирован в положении «restock невозможен» (SRS-DOM-054). */
  readonly locked: boolean
  /** Фактическое положение переключателя с учётом блокировки (locked ⇒ всегда `false`). */
  readonly value: boolean
}

/**
 * Given `controlCategory` товара в возврате, решает, заблокирован ли переключатель
 * `packagingIntact`. Домен (`ConfirmReturnReceivedUseCase.confirmWithRestockAttempt`, apps/api)
 * уничтожает контролируемое вещество НЕЗАВИСИМО от состояния упаковки — UI не должен создавать
 * иллюзию выбора там, где сервер всё равно откажет (DTJ-277 критерий приёмки 2).
 */
export function resolvePackagingToggleState(
  controlCategory: ControlCategoryPublic | undefined,
  requestedValue: boolean,
): PackagingToggleState {
  const isControlled = controlCategory !== undefined && controlCategory !== UNRESTRICTED_CONTROL_CATEGORY
  if (isControlled) {
    return { locked: true, value: false }
  }
  return { locked: false, value: requestedValue }
}

/** Тело `POST /:id/confirm` (1:1 `ConfirmReceivedChecklist`, apps/api) — `notes` опущен, если пуст. */
export interface ConfirmChecklistPayload {
  readonly packagingIntact: boolean
  readonly notes?: string
}

export function buildConfirmChecklistPayload(
  controlCategory: ControlCategoryPublic | undefined,
  state: ReturnChecklistState,
): ConfirmChecklistPayload {
  const { value } = resolvePackagingToggleState(controlCategory, state.packagingIntact)
  const trimmedNotes = state.notes.trim()
  return trimmedNotes.length > 0 ? { packagingIntact: value, notes: trimmedNotes } : { packagingIntact: value }
}

const MIN_REJECT_REASON_LENGTH = 1

/** `reason` обязателен ДО отправки на сервер (DTJ-277 критерий приёмки 3) — 1:1 с серверной `RejectReturnRequestSchema` (`z.string().min(1)`), продублировано на клиенте ради быстрой обратной связи, не взамен серверной валидации. */
export function isRejectReasonValid(reason: string): boolean {
  return reason.trim().length >= MIN_REJECT_REASON_LENGTH
}
