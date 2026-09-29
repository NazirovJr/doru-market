/**
 * `OnboardingApplicationDetailPage` (DTJ-075) — экран детали заявки
 * `/admin/onboarding-queue/:subjectType/:id`. Реквизиты и скан, чек-лист, действия оператора.
 */
import { useState, type ReactElement } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useT } from '@dorutj/i18n'
import { Button } from '@dorutj/ui'
import { httpRequest } from '@/shared/api/http-client'
import { useLocale } from '@/shared/config/locale-provider'
import { PharmacyVerificationDetailView } from './pharmacy-verification-detail'

const CHECKLIST_ITEMS = [
  'inn_matches_documents',
  'license_is_valid',
  'address_matches_license',
  'contact_phone_verified',
] as const

type SubjectType = 'pharmacy-chains' | 'pharmacy-accounts'
type ActionKind = 'approve' | 'request-changes' | 'reject' | 'terminate'

export const OnboardingApplicationDetailPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const params = useParams<{ subjectType?: string; id?: string }>()
  const subjectType = (params.subjectType ?? 'pharmacy-chains') as SubjectType
  const id = params.id ?? ''
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [notes] = useState('')
  const [reason, setReason] = useState('')
  const [terminateConfirmed, setTerminateConfirmed] = useState(false)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (action: ActionKind): Promise<void> => {
      const body = action === 'approve' ? { checklist, notes } : { reason }
      const res = await httpRequest(`/api/v1/admin/verifications/${subjectType}/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`action ${action} failed: ${String(res.status)}`)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding-queue'] })
      void queryClient.invalidateQueries({ queryKey: ['onboarding-application'] })
    },
  })
  const reasonMissing = reason.length === 0

  return (
    <section className="onboarding-application-detail" data-testid="onboarding-application-detail">
      <h2>{t('admin.onboarding_detail.heading', { id })}</h2>
      {subjectType === 'pharmacy-accounts' ? <PharmacyVerificationDetailView id={id} /> : null}
      <fieldset>
        <legend>{t('admin.onboarding_detail.checklist')}</legend>
        {CHECKLIST_ITEMS.map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              checked={checklist[item] ?? false}
              onChange={(e) => { setChecklist((prev) => ({ ...prev, [item]: e.target.checked })) }}
            />
            {t(`admin.onboarding_detail.check.${item}`)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('admin.onboarding_detail.actions')}</legend>
        <Button onClick={() => { mutation.mutate('approve') }} loading={mutation.isPending}>
          {t('admin.onboarding_detail.approve')}
        </Button>
        <input
          type="text"
          placeholder={t('admin.onboarding_detail.reason_placeholder')}
          value={reason}
          onChange={(e) => { setReason(e.target.value) }}
        />
        <Button
          variant="secondary"
          onClick={() => { mutation.mutate('request-changes') }}
          disabled={reasonMissing || mutation.isPending}
        >
          {t('admin.onboarding_detail.request_changes')}
        </Button>
        <Button
          variant="danger"
          onClick={() => { mutation.mutate('reject') }}
          disabled={reasonMissing || mutation.isPending}
        >
          {t('admin.onboarding_detail.reject')}
        </Button>
        <label>
          <input
            type="checkbox"
            checked={terminateConfirmed}
            onChange={(e) => { setTerminateConfirmed(e.target.checked) }}
          />
          {t('admin.onboarding_detail.confirm_terminate')}
        </label>
        <Button
          variant="danger"
          onClick={() => { mutation.mutate('terminate') }}
          disabled={!terminateConfirmed || reasonMissing || mutation.isPending}
        >
          {t('admin.onboarding_detail.terminate')}
        </Button>
      </fieldset>
      {mutation.isError ? <p role="alert">{t('admin.onboarding_detail.action_failed')}</p> : null}
      {mutation.isSuccess ? <p role="status">{t('admin.onboarding_detail.done')}</p> : null}
    </section>
  )
}
