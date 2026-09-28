// DTJ-356 — модалка admin-force-cancel. Клиентская проверка reason.length>=10 дублирует Zod
// сервера для мгновенной обратной связи, НЕ заменяет её (400 всё равно возможен, см. onError).
import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, Input, Modal } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAdminForceCancelOrder } from '../api/use-orders-admin'

const REASON_MIN_LENGTH = 10

export interface ForceCancelModalProps {
  readonly orderId: string
  readonly isOpen: boolean
  readonly onClose: () => void
}

export const ForceCancelModal = ({ orderId, isOpen, onClose }: ForceCancelModalProps): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [reason, setReason] = useState('')
  const mutation = useAdminForceCancelOrder(orderId)

  if (!isOpen) return null

  const isReasonTooShort = reason.trim().length < REASON_MIN_LENGTH
  const fieldError = reason.length > 0 && isReasonTooShort ? t('admin.order_detail.actions.reason_too_short') : undefined

  function handleClose(): void {
    setReason('')
    mutation.reset()
    onClose()
  }

  function handleSubmit(): void {
    if (isReasonTooShort) return
    mutation.mutate({ reason }, { onSuccess: handleClose })
  }

  return (
    <Modal isOpen title={t('admin.order_detail.actions.force_cancel.title')} closeButtonLabel={t('common.close')} onClose={handleClose}>
      <p role="alert">{t('admin.order_detail.actions.force_cancel.warning')}</p>
      <Input
        label={t('admin.order_detail.actions.reason_label')}
        value={reason}
        onChange={(event) => { setReason(event.target.value) }}
        data-testid="force-cancel-reason-input"
        {...(fieldError !== undefined && { error: fieldError })}
      />
      {mutation.error !== null ? <p role="alert">{mutation.error.message}</p> : null}
      <Button
        variant="danger"
        onClick={handleSubmit}
        loading={mutation.isPending}
        disabled={isReasonTooShort}
        data-testid="force-cancel-submit"
      >
        {t('admin.order_detail.actions.force_cancel.submit')}
      </Button>
    </Modal>
  )
}
