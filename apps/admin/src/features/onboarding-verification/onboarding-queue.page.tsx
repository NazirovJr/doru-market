/**
 * `OnboardingQueuePage` (DTJ-075) — экран `/admin/onboarding-queue`. Список
 * заявок `pending_review` с переключателем «Сети / Аптеки», старые первыми,
 * догрузка страниц по курсору.
 */
import { useState, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useT } from '@dorutj/i18n'
import { Button } from '@dorutj/ui'
import { httpRequest } from '@/shared/api/http-client'
import { useLocale } from '@/shared/config/locale-provider'

type SubjectType = 'pharmacy-chains' | 'pharmacy-accounts'

interface QueueItem {
  readonly id: string
  readonly status: string
  readonly submittedAt: string | null
  readonly reviewReason: string | null
  readonly slaTargetAt: string | null
}

interface QueuePageData {
  readonly items: readonly QueueItem[]
  readonly nextCursor: string | null
}

interface QueueResponse {
  readonly data: QueuePageData
}

const ISO_DATE_LENGTH = 10

async function fetchQueuePage(subjectType: SubjectType, cursor: string | null): Promise<QueuePageData> {
  const params = new URLSearchParams({ status: 'pending_review' })
  if (cursor !== null) {
    params.set('cursor', cursor)
  }
  const res = await httpRequest(`/api/v1/admin/verifications/${subjectType}?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`queue request failed: ${String(res.status)}`)
  }
  return ((await res.json()) as QueueResponse).data
}

export const OnboardingQueuePage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [subjectType, setSubjectType] = useState<SubjectType>('pharmacy-accounts')
  const queue = useInfiniteQuery({
    queryKey: ['onboarding-queue', subjectType],
    queryFn: ({ pageParam }) => fetchQueuePage(subjectType, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const items = (queue.data?.pages ?? []).flatMap((page) => page.items)

  return (
    <section className="onboarding-queue" data-testid="onboarding-queue">
      <h2>{t('admin.onboarding_queue.title')}</h2>
      <div className="subject-type-toggle">
        <button
          type="button"
          aria-pressed={subjectType === 'pharmacy-chains'}
          onClick={() => { setSubjectType('pharmacy-chains') }}
        >
          {t('admin.onboarding_queue.chains')}
        </button>
        <button
          type="button"
          aria-pressed={subjectType === 'pharmacy-accounts'}
          onClick={() => { setSubjectType('pharmacy-accounts') }}
        >
          {t('admin.onboarding_queue.pharmacies')}
        </button>
      </div>
      {queue.isLoading ? <p role="status">{t('admin.onboarding_queue.loading')}</p> : null}
      {queue.isError ? <p role="alert">{t('admin.onboarding_queue.error')}</p> : null}
      {queue.isSuccess && items.length === 0 ? <p>{t('admin.onboarding_queue.empty')}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link to={`/admin/onboarding-queue/${subjectType}/${item.id}`}>
              {item.id} — {item.status} ({(item.submittedAt ?? '').slice(0, ISO_DATE_LENGTH)})
            </Link>
          </li>
        ))}
      </ul>
      {queue.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => { void queue.fetchNextPage() }}
          disabled={queue.isFetchingNextPage}
        >
          {t('admin.onboarding_queue.load_more')}
        </Button>
      ) : null}
    </section>
  )
}
