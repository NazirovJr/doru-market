import { useCallback } from 'react'
import { useToast } from '@dorutj/ui'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useCartMutations } from '../api/use-cart-mutations'

const DEFAULT_QUANTITY = 1

export type AddToCart = (medicineId: string, pharmacyId: string) => void

export function useAddToCart(): AddToCart {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const toast = useToast()
  const { addItem } = useCartMutations()
  const { mutate } = addItem

  return useCallback(
    (medicineId, pharmacyId) => {
      mutate(
        { medicineId, pharmacyId, quantity: DEFAULT_QUANTITY },
        {
          onSuccess: () => toast.success(t('cart.added_toast')),
          onError: () => toast.error(t('ux.error.generic_500')),
        },
      )
    },
    [mutate, toast, t],
  )
}
