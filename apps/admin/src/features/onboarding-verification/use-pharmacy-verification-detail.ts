import { useEffect, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { httpGetJson, httpRequest } from '@/shared/api/http-client'

export interface PharmacyVerificationDetail {
  readonly id: string
  readonly name: string
  readonly addressText: string
  readonly phone: string
  readonly status: string
  readonly licenseNumber: string
  readonly licenseExpiryDate: string | null
  readonly pharmacistInChargeName: string | null
  readonly licenseScan: { readonly url: string; readonly contentType: string } | null
}

const DETAIL_PATH = '/api/v1/admin/verifications/pharmacy-accounts'
const ISO_DATE_LENGTH = 10

export function formatIsoDate(value: string | null): string {
  return value === null ? '' : value.slice(0, ISO_DATE_LENGTH)
}

export function usePharmacyVerificationDetail(id: string): UseQueryResult<PharmacyVerificationDetail> {
  return useQuery({
    queryKey: ['onboarding-application', 'pharmacy-accounts', id],
    queryFn: () => httpGetJson<PharmacyVerificationDetail>(`${DETAIL_PATH}/${id}`),
    enabled: id.length > 0,
  })
}

export interface LicenseScanBlob {
  readonly url: string | null
  readonly failed: boolean
}

// Ссылка подписана и живёт минуты; blob-URL избавляет от cross-origin ограничений встраивания (CORP/X-Frame-Options API).
export function useLicenseScanBlobUrl(link: PharmacyVerificationDetail['licenseScan']): LicenseScanBlob {
  const [state, setState] = useState<LicenseScanBlob>({ url: null, failed: false })
  const linkUrl = link?.url ?? null
  useEffect(() => {
    if (linkUrl === null) {
      return undefined
    }
    let objectUrl: string | null = null
    let cancelled = false
    httpRequest(linkUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`license scan download failed: ${String(response.status)}`)
        }
        const blob = await response.blob()
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob)
          setState({ url: objectUrl, failed: false })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ url: null, failed: true })
        }
      })
    return () => {
      cancelled = true
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [linkUrl])
  return state
}
