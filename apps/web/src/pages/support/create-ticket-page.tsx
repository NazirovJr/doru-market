/**
 * `CreateTicketPage` (DTJ-284) — `/support/new?orderId=`: хост `CreateTicketForm`. `orderId` —
 * читается из query (`ContactSupportButton` кладёт его туда, если открыт с экрана заказа) —
 * АС1/АС2 DTJ-284 («создан тикет с orderId, равным текущему заказу» / «orderId=null» без него).
 *
 * **Гейт аутентификации** — тот же приём, что `checkout-screen.tsx` (DTJ-235): `POST /api/v1/
 * support-tickets` требует `AuthGuard` (DTJ-282, любая аутентифицированная роль) — гость не
 * может создать обращение; экран сам проверяет `useAuthStore().accessToken`.
 */
import { useCallback, type ReactElement } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import { CreateTicketForm } from '@/features/support/ui/CreateTicketForm'

const SUPPORT_PAGE_PATH = '/support'

const CreateTicketPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const accessToken = useAuthStore((state) => state.accessToken)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('orderId') ?? undefined

  const handleCreated = useCallback((): void => {
    void navigate(SUPPORT_PAGE_PATH)
  }, [navigate])

  if (accessToken === null) {
    return (
      <section className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center" data-testid="create-ticket-unauthenticated">
        <p className="text-sm text-ink-muted">{t('customer.support.unauthenticated')}</p>
        <button
          type="button"
          onClick={() => { void navigate('/login') }}
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-6 font-semibold text-white"
        >
          {t('checkout.unauthenticated_cta')}
        </button>
      </section>
    )
  }

  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4" data-testid="create-ticket-page">
      <h1 className="text-lg font-semibold text-ink">{t('customer.support.form.title')}</h1>
      <CreateTicketForm {...(orderId !== undefined && { orderId })} onCreated={handleCreated} />
    </section>
  )
}

export default CreateTicketPage
