/**
 * `parseListCursor` (EP-14, DTJ-282) — декодирует opaque cursor `GET /api/v1/support-tickets`
 * в `{v, id}` (SQL keyset, `drizzle-support-tickets.repository.ts`). 1:1 приём с
 * `pharmacy-accounts-report-query.util.ts` (`parseListQuery`, DTJ-252) — см. JSDoc
 * `list-support-tickets-query.dto.ts` про то, почему не переиспользован `CursorQueryPipe`.
 */
import { decodeCursor, InvalidCursorError } from '@dorutj/contracts'
import type { ListSupportTicketsCursor } from '../application/use-cases/list-support-tickets.use-case.js'

export function parseListCursor(raw: string | undefined): ListSupportTicketsCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}
