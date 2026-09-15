/**
 * `CreateSupportTicketSchema` (EP-14, DTJ-282) — `POST /api/v1/support-tickets` body.
 *
 * `channel` — НЕ полный `SupportTicketChannel` (4 значения): `'system_auto'` исключён намеренно.
 * Это значение зарезервировано за `SupportFacade.createAutoTicket` (DTJ-281, server-to-server,
 * ДРУГИЕ модули) — публичный HTTP-вход не может выдать себя за системного инициатора, иначе
 * `createdBy` осмысленно теряет проверку владения заказом (`assertOwnershipIfCustomerOrder`,
 * `create-support-ticket.use-case.ts`, пропускает её БЕЗУСЛОВНО для `system_auto`).
 *
 * `description` — обязателен (не `?`, в отличие от domain `SupportTicketOpenCommand.description`,
 * где он опционален ради системных авто-тикетов): человек, открывающий обращение через эту форму,
 * обязан описать проблему — то же требование, что DTJ-284 «Что сделать» п.2 (`Textarea, обязателен`).
 */
import { z } from 'zod'
import { SUPPORT_TICKET_CATEGORY_VALUES } from '@dorutj/contracts'

const MIN_DESCRIPTION_LENGTH = 1

/** Подмножество `SupportTicketChannel` — см. JSDoc файла про исключение `system_auto`. */
const HTTP_CREATABLE_CHANNEL_VALUES = ['in_app', 'telegram_bot', 'phone'] as const

export const CreateSupportTicketSchema = z.object({
  orderId: z.uuid().optional(),
  channel: z.enum(HTTP_CREATABLE_CHANNEL_VALUES),
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES),
  description: z.string().trim().min(MIN_DESCRIPTION_LENGTH),
})

export type CreateSupportTicketDto = z.infer<typeof CreateSupportTicketSchema>
