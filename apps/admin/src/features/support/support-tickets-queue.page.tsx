/**
 * `SupportTicketsQueuePage` (DTJ-283) — экран `/admin/support-tickets`. Тонкая композиция
 * `SupportTicketQueue`, ноль бизнес-логики (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5) — тот же
 * приём, что `onboarding-queue.page.tsx` (DTJ-075): страница живёт в корне `features/support/`,
 * не в `ui/` (`apps/admin` не заводит отдельный слой `pages/`, см. её JSDoc).
 */
import type { ReactElement } from 'react'
import { SupportTicketQueue } from './ui/SupportTicketQueue'

export const SupportTicketsQueuePage = (): ReactElement => <SupportTicketQueue />
