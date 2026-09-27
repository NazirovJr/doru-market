import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'

/** Блокирующий диалог без кнопки закрытия — дальнейшие действия на экране недоступны. */
export const OrderCancelledDialog = (): ReactElement => {
  const { t } = useT('tj')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="order-cancelled-title" data-testid="order-cancelled-dialog" className="flex max-w-sm flex-col gap-2 rounded-md bg-surface p-6 text-center">
        <p id="order-cancelled-title" className="text-base font-semibold text-brand-danger">
          {t('pharmacy.picking.cancelled_dialog.title')}
        </p>
        <p className="text-sm text-ink-muted">{t('pharmacy.picking.cancelled_dialog.body')}</p>
      </div>
    </div>
  )
}
