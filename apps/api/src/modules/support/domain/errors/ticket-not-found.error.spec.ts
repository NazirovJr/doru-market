import { describe, expect, it } from 'vitest'
import { DomainError } from '@dorutj/contracts'
import { TicketNotFoundError } from './ticket-not-found.error.js'

// DTJ-282 централизовал этот класс в `@dorutj/contracts/domain-errors-support.ts` (было —
// локальный `Error`-потомок с прямым полем `ticketId`, DTJ-278) — `AllExceptionsFilter` (DTJ-018)
// распознаёт только `instanceof DomainError`. `ticketId` теперь читается через `details`
// (`NotFoundError`-совместимая форма), не как отдельное поле экземпляра.
describe('TicketNotFoundError', () => {
  it('несёт details.ticketId/code/name и понятное сообщение', () => {
    const error = new TicketNotFoundError('ticket-404')
    expect(error).toBeInstanceOf(DomainError)
    expect(error.details).toEqual({ ticketId: 'ticket-404' })
    expect(error.code).toBe('TICKET_NOT_FOUND')
    expect(error.name).toBe('TicketNotFoundError')
    expect(error.message).toContain('ticket-404')
  })
})
