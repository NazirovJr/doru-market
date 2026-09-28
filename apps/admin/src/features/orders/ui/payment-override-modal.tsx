// DTJ-356 — модалка payment-override. Поля txId/amountDiram/paidAt — банковское подтверждение,
// которое реально требует домен (см. JSDoc admin-payment-override.use-case.ts на бэкенде):
// SRS-ADM-032 называет только { reason }, но единственная существующая доменная мутация
// (DTJ-246, AdminPaymentOverrideUseCase) без этих полей не выполнима.
import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, Input, Modal } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAdminPaymentOverride } from '../api/use-orders-admin'

const REASON_MIN_LENGTH = 10

export interface PaymentOverrideModalProps {
  readonly orderId: string
  readonly isOpen: boolean
  readonly onClose: () => void
}

export const PaymentOverrideModal = ({ orderId, isOpen, onClose }: PaymentOverrideModalProps): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [reason, setReason] = useState('')
  const [txId, setTxId] = useState('')
  const [amountDiram, setAmountDiram] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const mutation = useAdminPaymentOverride(orderId)

  if (!isOpen) return null

  const isReasonTooShort = reason.trim().length < REASON_MIN_LENGTH
  const fieldError = reason.length > 0 && isReasonTooShort ? t('admin.order_detail.actions.reason_too_short') : undefined
  const canSubmit = !isReasonTooShort && txId.trim().length > 0 && amountDiram.trim().length > 0 && paidAt.trim().length > 0

  function handleClose(): void {
    setReason('')
    setTxId('')
    setAmountDiram('')
    setPaidAt('')
    mutation.reset()
    onClose()
  }

  function handleSubmit(): void {
    if (!canSubmit) return
    mutation.mutate({ reason, txId, amountDiram, paidAt: new Date(paidAt).toISOString() }, { onSuccess: handleClose })
  }

  return (
    <Modal isOpen title={t('admin.order_detail.actions.payment_override.title')} closeButtonLabel={t('common.close')} onClose={handleClose}>
      <p role="alert">{t('admin.order_detail.actions.payment_override.warning')}</p>
      <Input
        label={t('admin.order_detail.actions.payment_override.tx_id_label')}
        value={txId}
        onChange={(event) => { setTxId(event.target.value) }}
        data-testid="payment-override-tx-id-input"
      />
      <Input
        label={t('admin.order_detail.actions.payment_override.amount_label')}
        value={amountDiram}
        onChange={(event) => { setAmountDiram(event.target.value) }}
        data-testid="payment-override-amount-input"
      />
      <Input
        label={t('admin.order_detail.actions.payment_override.paid_at_label')}
        type="datetime-local"
        value={paidAt}
        onChange={(event) => { setPaidAt(event.target.value) }}
        data-testid="payment-override-paid-at-input"
      />
      <Input
        label={t('admin.order_detail.actions.reason_label')}
        value={reason}
        onChange={(event) => { setReason(event.target.value) }}
        data-testid="payment-override-reason-input"
        {...(fieldError !== undefined && { error: fieldError })}
      />
      {mutation.error !== null ? <p role="alert">{mutation.error.message}</p> : null}
      <Button
        variant="danger"
        onClick={handleSubmit}
        loading={mutation.isPending}
        disabled={!canSubmit}
        data-testid="payment-override-submit"
      >
        {t('admin.order_detail.actions.payment_override.submit')}
      </Button>
    </Modal>
  )
}
