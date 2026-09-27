import { useEffect, useRef, useState, type ReactElement, type SubmitEvent } from 'react'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { HttpError } from '@/shared/api/http-client'
import { useScanOrderItem } from '@/features/order-fulfillment/api/order-items.api'
import { resolveScanErrorMessageKey, resolveWrongBarcodeMessage } from '@/features/order-fulfillment/model/picking.model'

export interface BarcodeScanFormProps {
  readonly orderId: string
  readonly itemId: string
  /** Эргономика последовательного сканирования — сообщить родителю о решённой позиции (следующий фокус). */
  readonly onScanned: (itemId: string) => void
}

/** Поле «Ввести штрихкод» одной конкретной позиции — открывается по выбору строки. */
export const BarcodeScanForm = ({ orderId, itemId, onScanned }: BarcodeScanFormProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [rawBarcode, setRawBarcode] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const scanItem = useScanOrderItem(orderId)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (rawBarcode.trim().length === 0) return
    scanItem.mutate(
      { itemId, rawBarcode: rawBarcode.trim(), idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: () => {
          setRawBarcode('')
          onScanned(itemId)
        },
      },
    )
  }

  const error = scanItem.error
  const errorMessage =
    error instanceof HttpError
      ? error.code === 'ORDER_ITEM_NOT_FOUND'
        ? resolveWrongBarcodeMessage(t, error.details)
        : t(resolveScanErrorMessageKey(error.code))
      : null

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2" data-testid="barcode-scan-form">
      <input
        ref={inputRef}
        value={rawBarcode}
        onChange={(event) => { setRawBarcode(event.target.value) }}
        inputMode="numeric"
        placeholder={t('pharmacy.picking.scan.input_placeholder')}
        data-testid="barcode-scan-input"
        className="min-h-[56px] rounded-md border border-line px-3 text-lg text-ink"
      />
      {errorMessage !== null ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="barcode-scan-error">
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={scanItem.isPending || rawBarcode.trim().length === 0}
        data-testid="barcode-scan-submit"
        className="min-h-[56px] rounded-md bg-brand-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {scanItem.isPending ? t('pharmacy.picking.scan.submit_pending') : t('pharmacy.picking.scan.submit')}
      </button>
    </form>
  )
}
