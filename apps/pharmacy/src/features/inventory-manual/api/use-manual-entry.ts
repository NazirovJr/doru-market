import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { ManualEntryRow, ManualEntryResponse } from '@dorutj/contracts'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { INVENTORY_LIST_QUERY_KEY } from '@/shared/api/inventory-query-keys'

const MANUAL_ENTRY_PATH = '/api/v1/inventory-manual-entry'

/** Реэкспорт для обратной совместимости импортов (ключ теперь общий, см. `shared/api/inventory-query-keys`). */
export { INVENTORY_LIST_QUERY_KEY }

interface ManualEntryRequestBody {
  readonly rows: readonly [ManualEntryRow]
}

export function useManualEntry(): UseMutationResult<ManualEntryResponse, HttpError, ManualEntryRow> {
  const queryClient = useQueryClient()
  return useMutation<ManualEntryResponse, HttpError, ManualEntryRow>({
    mutationKey: ['inventory', 'manual-entry'],
    // Повторную отправку контролирует UI (кнопка блокируется на isPending), не транспорт.
    retry: 0,
    mutationFn: (row: ManualEntryRow): Promise<ManualEntryResponse> => {
      const body: ManualEntryRequestBody = { rows: [row] }
      return httpPostJson<ManualEntryResponse>(MANUAL_ENTRY_PATH, body)
    },
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_LIST_QUERY_KEY })
    },
  })
}
