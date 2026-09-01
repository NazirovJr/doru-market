/**
 * `OnboardingQueuePage` (DTJ-075) — экран `/admin/onboarding-queue`. Список
 * заявок `pending_review` с переключателем «Сети / Аптеки», FIFO-порядок.
 */
import { useState, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { httpRequest } from '@/shared/api/http-client'

type SubjectType = 'pharmacy-chains' | 'pharmacy-accounts'

interface QueueItem {
  readonly id: string
  readonly status: string
  readonly submittedAt: string | null
  readonly reviewReason: string | null
  readonly slaTargetAt: string | null
}

interface QueueResponse {
  readonly data: { readonly items: readonly QueueItem[]; readonly total: number }
}

export const OnboardingQueuePage = (): ReactElement => {
  const [subjectType, setSubjectType] = useState<SubjectType>('pharmacy-chains')
  const queue = useQuery({
    queryKey: ['onboarding-queue', subjectType],
    queryFn: async (): Promise<readonly QueueItem[]> => {
      const res = await httpRequest(`/api/v1/admin/verifications/${subjectType}?status=pending_review`)
      if (!res.ok) {
        return []
      }
      const body = (await res.json()) as QueueResponse
      return body.data.items
    },
  })

  return (
    <section className="onboarding-queue" data-testid="onboarding-queue">
      <h2>Очередь верификации</h2>
      <div className="subject-type-toggle">
        <button
          type="button"
          aria-pressed={subjectType === 'pharmacy-chains'}
          onClick={() => { setSubjectType('pharmacy-chains') }}
        >
          Сети
        </button>
        <button
          type="button"
          aria-pressed={subjectType === 'pharmacy-accounts'}
          onClick={() => { setSubjectType('pharmacy-accounts') }}
        >
          Аптеки
        </button>
      </div>
      {queue.isLoading ? <p>Загрузка...</p> : null}
      {queue.error !== null ? <p role="alert">Ошибка загрузки</p> : null}
      <ul>
        {(queue.data ?? []).map((item) => (
          <li key={item.id}>
            <Link to={`/admin/onboarding-queue/${subjectType}/${item.id}`}>
              {item.id} — {item.status} ({(item.submittedAt ?? '').slice(0, 10)})
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
