/**
 * `SupportPage` (DTJ-284) — `/support`: список своих обращений + вход в форму создания нового.
 * Тонкая композиция (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5) — ноль бизнес-логики.
 *
 * Точка размещения в навигации НЕ зафиксирована ни в одном UX-документе явно (DTJ-284 «Риски») —
 * отдельный маршрут `/support` (не `/profile/support`, `/profile` тоже не существует в
 * `apps/web` на момент этого тикета, проверено) — простейший вариант, не блокирует реализацию.
 */
import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { ContactSupportButton } from '@/features/support/ui/ContactSupportButton'
import { MyTicketsList } from '@/features/support/ui/MyTicketsList'

const SupportPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4" data-testid="support-page">
      <h1 className="text-lg font-semibold text-ink">{t('customer.support.page_title')}</h1>
      <ContactSupportButton />
      <MyTicketsList />
    </section>
  )
}

export default SupportPage
