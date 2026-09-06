/**
 * `ListSupportTicketsQuerySchema` (EP-14, DTJ-282) — файл СВЕРХ буквального `files_owned` тикета
 * (тот же приём, что `support-unit-of-work.port.ts`, DTJ-279, — правило 11 AGENTS.md):
 * `GET /api/v1/support-tickets?status=&category=&priority=&limit=&cursor=` не может обойтись без
 * валидации этих полей, а `files_owned` DTJ-282 называет только 3 конкретных DTO
 * (create/add-message/change-status), не список целиком.
 *
 * Расширяет `cursorQuerySchema` (`@dorutj/contracts`, DTJ-005) ВМЕСТО отдельного
 * `CursorQueryPipe` (`common/http/pipes/cursor-query.pipe.ts`, DTJ-018): тот пайп проектировался
 * под `sort`-параметр с валидируемым enum'ом И, что важнее, его внутренний `decodeCursor`
 * СОЗНАТЕЛЬНО отбрасывает `cursor.id` (нужен только `PharmacyTerminalQueueController`, чья
 * пагинация — in-memory, не SQL keyset). `list()` этого тикета — РЕАЛЬНАЯ SQL keyset-пагинация
 * (`createdAt`+`id`, см. `drizzle-support-tickets.repository.ts`) — тот же паттерн, что
 * `GetPayoutsController`/`pharmacy-accounts-report-query.util.ts` (DTJ-252): курсор
 * декодируется ЦЕЛИКОМ (`{v, id}`) через `decodeCursor` из `@dorutj/contracts`, не через
 * `CursorQueryPipe`. Один `@Query(new ZodValidationPipe(...))`-параметр — держит контроллер в
 * пределах `max-params` ≤3 (C5), не требуя отдельного параметра на каждый из limit/cursor/
 * status/category/priority.
 */
import { z } from 'zod'
import { cursorQuerySchema, SUPPORT_TICKET_CATEGORY_VALUES, SUPPORT_TICKET_STATUS_VALUES } from '@dorutj/contracts'

const MIN_PRIORITY = 0

export const ListSupportTicketsQuerySchema = cursorQuerySchema.extend({
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES).optional(),
  priority: z.coerce.number().int().min(MIN_PRIORITY).optional(),
})

export type ListSupportTicketsQueryDto = z.infer<typeof ListSupportTicketsQuerySchema>
