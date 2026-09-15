/**
 * `ContactSupportButton` (DTJ-284) — «Написать в поддержку»: навигация на отдельный экран
 * `/support/new` (+ `?orderId=` если задан), НЕ модальное окно — `packages/ui` не несёт
 * Modal/BottomSheet ни одного (EP-18, DTJ-406, `packages/ui/src/index.ts` пуст, проверено), а
 * ticket «Что сделать» п.3 явно разрешает ЛИБО модалку, ЛИБО отдельный экран и требует «не
 * изобретать новый механизм модалок, если он уже есть» — раз его нет, простая навигация
 * (`useNavigate`, уже установленный механизм ВЕЗДЕ в `apps/web`) значительно ниже риска, чем
 * заводить модальную инфраструктуру с нуля ради одной кнопки.
 *
 * `orderId` — опционален: кнопка предназначена и для будущего `/orders/:id` (эта страница ещё не
 * реализована ни одним эпиком на момент DTJ-284, см. отчёт сдачи «Риски»), и для общего входа без
 * привязки к заказу (`support-page.tsx`).
 */
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'

export interface ContactSupportButtonProps {
  readonly orderId?: string
}

function buildSupportNewPath(orderId: string | undefined): string {
  return orderId === undefined ? '/support/new' : `/support/new?orderId=${encodeURIComponent(orderId)}`
}

export const ContactSupportButton = ({ orderId }: ContactSupportButtonProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()

  return (
    <button
      type="button"
      data-testid="contact-support-button"
      onClick={() => { void navigate(buildSupportNewPath(orderId)) }}
      className="inline-flex min-h-12 items-center justify-center rounded-md border border-line px-4 font-semibold text-ink"
    >
      {t('customer.support.contact_button')}
    </button>
  )
}
