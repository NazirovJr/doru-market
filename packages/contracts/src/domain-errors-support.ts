/**
 * Доменные ошибки модуля `support` (DTJ-282, EP-14, `docs/spec/10-domain-model.md` — эти три
 * класса НЕ входили в исходную транскрипцию DTJ-005 (`grep -rn "Ticket" domain-errors.ts` до
 * этого файла — эквивалента нет): DTJ-278 завёл их локально как обычные `Error`-потомки
 * (`modules/support/domain/errors/*.ts`, «домен остаётся переносимым без инфраструктуры»), но
 * `AllExceptionsFilter` (DTJ-018) распознаёт ТОЛЬКО `instanceof DomainError` — обычный `Error`
 * молча падает в generic `500 INTERNAL_ERROR`. DTJ-282 «Что сделать» п.5/DoD прямо требует
 * `404 TICKET_NOT_FOUND`/`409 TICKET_ALREADY_TERMINAL`/`409 INVALID_TICKET_STATUS_TRANSITION`
 * через «уже установленный единый фильтр, не третий фильтр ошибок для этого модуля» — единственный
 * способ дать `AllExceptionsFilter` увидеть их и есть централизация в `@dorutj/contracts`.
 *
 * Отдельный файл, НЕ дописано в `domain-errors.ts` (та же причина, что
 * `domain-errors-pharmacy-terminal.ts`, DTJ-300 — split по `max-lines: 300`, `domain-errors.ts`
 * уже плотный). Классы наследуют `NotFoundError`/`ConflictError` — промежуточные классы,
 * определённые В `domain-errors.ts`, поэтому импорт отсюда ОДНОСТОРОННИЙ (этот файл →
 * `domain-errors.ts`), `domain-errors.ts` этот файл НЕ реэкспортирует (иначе цикл при
 * инициализации модуля, см. JSDoc `domain-errors-pharmacy-terminal.ts`) — публичный API пакета
 * не теряется, барабанный `index.ts` экспортирует ЭТОТ файл отдельной строкой.
 *
 * `modules/support/domain/errors/*.ts` (DTJ-278) обновлены этим же тикетом на РЕ-ЭКСПОРТ отсюда
 * (тот же приём, что `modules/returns/domain/errors/duplicate-active-return.error.ts`) — не
 * вторая параллельная копия класса под тем же именем (правило 12 AGENTS.md).
 */
import { ErrorCode } from './errors.js'
import { ConflictError, NotFoundError } from './domain-errors.js'

/** SRS-ADM-076 — тикет удалён/не существует (в т.ч. гонка между SQL-сканом воркера DTJ-280 и вызовом). */
export class TicketNotFoundError extends NotFoundError {
  constructor(ticketId: string) {
    super({ ticketId }, ErrorCode.TICKET_NOT_FOUND, `Support ticket "${ticketId}" not found`)
  }
}

/**
 * SRS-ADM-078-подобный принцип — мутация тикета, уже `closed` (терминальный статус без
 * исключений, в отличие от `resolved`, откуда допущено переоткрытие). Отдельно от
 * `InvalidTicketStatusTransitionError` (DTJ-278 различает их явно: «терминальный closed —
 * любая мутация после него бросает именно этот класс»).
 */
export class TicketAlreadyTerminalError extends ConflictError {
  constructor(ticketId: string) {
    super(`Support ticket "${ticketId}" is already terminal (closed)`, { ticketId }, ErrorCode.TICKET_ALREADY_TERMINAL)
  }
}

/** Недопустимый переход `support_ticket_status`, не связанный с терминальностью `closed`. */
export class InvalidTicketStatusTransitionError extends ConflictError {
  constructor(ticketId: string, from: string, to: string) {
    super(`Support ticket "${ticketId}": invalid transition ${from} -> ${to}`, { ticketId, from, to }, ErrorCode.INVALID_TICKET_STATUS_TRANSITION)
  }
}
