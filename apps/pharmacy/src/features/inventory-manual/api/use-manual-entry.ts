import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { ManualEntryRow, ManualEntryResponse } from '@dorutj/contracts'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'

/**
 * `use-manual-entry.ts` (DTJ-167, EP-05, SRS-INV-015/016) — `POST /api/v1/inventory-manual-entry`
 * (DTJ-162) с ОДНОЙ строкой (`rows: [row]`, точечное редактирование, не сетка DTJ-168).
 *
 * `retry: 0` — тот же приём, что `useConfirmReturn` (`features/returns/api/use-confirm-return.ts`):
 * повторная отправка того же ввода — забота UI (кнопка блокируется на `isPending`,
 * `PointEditForm.tsx`), не транспортного ретрая.
 *
 * `INVENTORY_LIST_QUERY_KEY` — «список остатков, если уже закэширован» (DTJ-167 «Что сделать»
 * п.4). Список остатков ФИЗИЧЕСКИ не существует в кабинете аптеки на момент этого тикета (сетка
 * DTJ-168 — второй таб `InventoryPage.tsx`, вне periметра DTJ-167) — `invalidateQueries` на ключ,
 * под которым сейчас ничего не закэшировано, безопасный no-op, но готовит инвалидацию заранее для
 * DTJ-168, который переиспользует этот же ключ при чтении списка (см. JSDoc DoD там).
 */
const MANUAL_ENTRY_PATH = '/api/v1/inventory-manual-entry'

export const INVENTORY_LIST_QUERY_KEY = ['inventory', 'list'] as const

interface ManualEntryRequestBody {
  readonly rows: readonly [ManualEntryRow]
}

export function useManualEntry(): UseMutationResult<ManualEntryResponse, HttpError, ManualEntryRow> {
  const queryClient = useQueryClient()
  return useMutation<ManualEntryResponse, HttpError, ManualEntryRow>({
    mutationKey: ['inventory', 'manual-entry'],
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
