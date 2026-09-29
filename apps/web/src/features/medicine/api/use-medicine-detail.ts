import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'
import { useLocale } from '@/shared/config/locale-provider'

// Форма списана с `MedicineDetailDto` (apps/api catalog/presentation/dto), в пакете контрактов её нет.
export interface MedicineDetail {
  readonly id: string
  readonly tradeName: string
  readonly innName: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly manufacturerName: string
  readonly manufacturerCountry: string
  readonly isPrescriptionRequired: boolean
  readonly description: string | null
}

export function useMedicineDetail(medicineId: string): UseQueryResult<MedicineDetail, HttpError> {
  const { locale } = useLocale()
  return useQuery<MedicineDetail, HttpError>({
    queryKey: ['medicine', medicineId, locale],
    queryFn: ({ signal }) => httpGetJson<MedicineDetail>(`/api/v1/medicines/${medicineId}`, { locale }, signal),
    enabled: medicineId.length > 0,
    retry: 0,
  })
}
