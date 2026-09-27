// Свой минимальный запрос списка "своих" точек — НЕ импортирует features/pharmacies-crud (горизонтальные импорты между фичами запрещены).
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type {
  PharmacyAccountAdminSummaryDto,
  PharmacyDeliveryZoneDto,
  PharmacyScheduleAndZoneDto,
  UpdateDeliveryZoneBodyDto,
  UpdatePharmacyScheduleBodyDto,
} from '@dorutj/contracts'
import { httpGetJson, httpGetJsonWithMeta, httpPatchJson, type HttpError } from '@/shared/api/http-client'

const PHARMACY_ACCOUNTS_PATH = '/api/v1/pharmacy-accounts'
const OWN_PHARMACIES_LIMIT = 100

export function ownPharmacyOptionsQueryKey(): readonly unknown[] {
  return ['admin', 'schedule', 'own-pharmacy-options'] as const
}

export function useOwnPharmacyOptions(): UseQueryResult<readonly PharmacyAccountAdminSummaryDto[], HttpError> {
  return useQuery<readonly PharmacyAccountAdminSummaryDto[], HttpError>({
    queryKey: ownPharmacyOptionsQueryKey(),
    queryFn: () =>
      httpGetJsonWithMeta<readonly PharmacyAccountAdminSummaryDto[]>(PHARMACY_ACCOUNTS_PATH, {
        scope: 'own',
        limit: String(OWN_PHARMACIES_LIMIT),
      }).then((r) => r.data),
  })
}

export function pharmacyScheduleQueryKey(pharmacyId: string): readonly unknown[] {
  return ['admin', 'schedule', 'detail', pharmacyId] as const
}

export function usePharmacySchedule(pharmacyId: string | null): UseQueryResult<PharmacyScheduleAndZoneDto, HttpError> {
  return useQuery<PharmacyScheduleAndZoneDto, HttpError>({
    queryKey: pharmacyScheduleQueryKey(pharmacyId ?? ''),
    queryFn: () => httpGetJson<PharmacyScheduleAndZoneDto>(`${PHARMACY_ACCOUNTS_PATH}/${pharmacyId ?? ''}/schedule`),
    enabled: pharmacyId !== null,
  })
}

export interface UpdateScheduleInput {
  readonly pharmacyId: string
  readonly body: UpdatePharmacyScheduleBodyDto
}

export function useUpdatePharmacySchedule(): UseMutationResult<PharmacyScheduleAndZoneDto, HttpError, UpdateScheduleInput> {
  const queryClient = useQueryClient()
  return useMutation<PharmacyScheduleAndZoneDto, HttpError, UpdateScheduleInput>({
    mutationFn: ({ pharmacyId, body }) =>
      httpPatchJson<PharmacyScheduleAndZoneDto>(`${PHARMACY_ACCOUNTS_PATH}/${pharmacyId}/schedule`, body),
    onSuccess: (updated, { pharmacyId }) => { queryClient.setQueryData(pharmacyScheduleQueryKey(pharmacyId), updated) },
  })
}

export interface UpdateDeliveryZoneInput {
  readonly pharmacyId: string
  readonly body: UpdateDeliveryZoneBodyDto
}

export function useUpdateDeliveryZone(): UseMutationResult<PharmacyDeliveryZoneDto, HttpError, UpdateDeliveryZoneInput> {
  const queryClient = useQueryClient()
  return useMutation<PharmacyDeliveryZoneDto, HttpError, UpdateDeliveryZoneInput>({
    mutationFn: ({ pharmacyId, body }) => httpPatchJson<PharmacyDeliveryZoneDto>(`${PHARMACY_ACCOUNTS_PATH}/${pharmacyId}/delivery-zone`, body),
    onSuccess: (updated, { pharmacyId }) => {
      queryClient.setQueryData(pharmacyScheduleQueryKey(pharmacyId), (prev: PharmacyScheduleAndZoneDto | undefined) =>
        prev === undefined ? prev : { ...prev, maxDeliveryRadiusKm: updated.maxDeliveryRadiusKm },
      )
    },
  })
}

export type { HttpError }
