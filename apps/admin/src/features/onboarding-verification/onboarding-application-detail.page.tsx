/**
 * `OnboardingApplicationDetailPage` (DTJ-075) — экран детали заявки
 * `/admin/onboarding-queue/:subjectType/:id`. Чек-лист + действия оператора.
 */
import { useState, type ReactElement } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { httpRequest } from '@/shared/api/http-client'

const CHECKLIST_ITEMS = [
  'inn_matches_documents',
  'license_is_valid',
  'address_matches_license',
  'contact_phone_verified',
] as const

type SubjectType = 'pharmacy-chains' | 'pharmacy-accounts'
type ActionKind = 'approve' | 'request-changes' | 'reject' | 'terminate'

export const OnboardingApplicationDetailPage = (): ReactElement => {
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
    },
  })

  return (
    <section className="onboarding-application-detail" data-testid="onboarding-application-detail">
      <h2>Заявка {id}</h2>
      <fieldset>
        <legend>Чек-лист</legend>
        {CHECKLIST_ITEMS.map((item) => (
          <label key={item}>
            <input
              type="checkbox"
              checked={checklist[item] ?? false}
              onChange={(e) => { setChecklist((prev) => ({ ...prev, [item]: e.target.checked })) }}
            />
            {item}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Действия</legend>
        <button
          type="button"
          onClick={() => { mutation.mutate('approve') }}
          disabled={mutation.isPending}
        >
          Одобрить
        </button>
        <input
          type="text"
          placeholder="Причина для request-changes"
          value={reason}
          onChange={(e) => { setReason(e.target.value) }}
        />
        <button
          type="button"
          onClick={() => { mutation.mutate('request-changes') }}
          disabled={reason.length === 0 || mutation.isPending}
        >
          Запросить изменения
        </button>
        <button
          type="button"
          onClick={() => { mutation.mutate('reject') }}
          disabled={reason.length === 0 || mutation.isPending}
        >
          Отклонить
        </button>
        <label>
          <input
            type="checkbox"
            checked={terminateConfirmed}
            onChange={(e) => { setTerminateConfirmed(e.target.checked) }}
          />
          Подтверждаю необратимость
        </label>
        <button
          type="button"
          onClick={() => { mutation.mutate('terminate') }}
          disabled={!terminateConfirmed || reason.length === 0 || mutation.isPending}
        >
          Прекратить
        </button>
      </fieldset>
      {mutation.error !== null ? <p role="alert">{String(mutation.error)}</p> : null}
      {mutation.isSuccess ? <p>Готово</p> : null}
    </section>
  )
}
