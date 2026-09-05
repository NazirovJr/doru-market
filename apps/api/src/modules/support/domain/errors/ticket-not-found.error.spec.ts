import { describe, expect, it } from 'vitest'
import { TicketNotFoundError } from './ticket-not-found.error.js'

describe('TicketNotFoundError', () => {
  it('несёт ticketId/code/name и понятное сообщение', () => {
    const error = new TicketNotFoundError('ticket-404')
    expect(error).toBeInstanceOf(Error)
    expect(error.ticketId).toBe('ticket-404')
    expect(error.code).toBe('TICKET_NOT_FOUND')
    expect(error.name).toBe('TicketNotFoundError')
    expect(error.message).toContain('ticket-404')
  })
})
