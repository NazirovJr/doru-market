/**
 * `FeatureFlagsPage` (EP-15, DTJ-352) — экран `/admin/feature-flags`. Таблица всех флагов
 * (флаг/скоуп/тенант/`isEnabled`/`rolloutPercentage`) + форма добавления. Единственный файл
 * (`files_owned` тикета — ровно этот путь), поэтому запросы к API инлайн в компоненте, без
 * отдельных `api/`/`model/` подпапок — тот же приём, что `onboarding-queue.page.tsx` (DTJ-075).
 *
 * Switch-переключатель `isEnabled` — тикет ссылается на `packages/ui`, но
 * `packages/ui/src/index.ts` пуст (EP-18/DTJ-406 ещё не наполнил пакет, проверено, тот же факт,
 * что уже задокументирован `role-routes.ts`/`SlaBadge.tsx`) — здесь native `<input type=
 * "checkbox">`, стилизованный CSS-переменными `index.html` (`--brand-*`), заменяется на реальный
 * `Switch` из `packages/ui` одной правкой, когда компонент появится.
 *
 * Тенант в форме добавления — текстовый UUID-инпут, НЕ `Select` из списка тенантов DTJ-351: тот
 * тикет (эндпоинт `GET /api/v1/tenants`) на момент реализации ЕЩЁ НЕ существует в кодовой базе
 * (проверено — `apps/api/src/modules/admin/presentation/tenants.controller.ts` отсутствует).
 * Заменяется на `Select` одной правкой, когда DTJ-351 будет сдан.
 */
import { useState, type ChangeEvent, type ReactElement, type SyntheticEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { FEATURE_FLAG_SCOPE_VALUES, type FeatureFlagDto, type FeatureFlagScope, type UpsertFeatureFlagDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { adminRequest } from '@/shared/api/admin-client'

const FEATURE_FLAGS_PATH = '/feature-flags'
const FEATURE_FLAGS_QUERY_KEY = ['admin', 'feature-flags', 'list'] as const
const LIST_LIMIT = '100'
const MIN_ROLLOUT_PERCENTAGE = 0
const MAX_ROLLOUT_PERCENTAGE = 100

interface ListResponse {
  readonly data: readonly FeatureFlagDto[]
}
interface ItemResponse {
  readonly data: FeatureFlagDto
}

function jsonRequestInit(method: 'POST' | 'PATCH', body: UpsertFeatureFlagDto): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

interface UpsertFields {
  readonly flagKey: string
  readonly scope: FeatureFlagScope
  readonly tenantId: string | null
  readonly isEnabled: boolean
  readonly rolloutPercentage: number
}

/** `exactOptionalPropertyTypes` — `tenantId` ОПУЩЕН целиком для `scope='global'`, не `undefined`. */
function toUpsertBody(fields: UpsertFields): UpsertFeatureFlagDto {
  return {
    flagKey: fields.flagKey,
    scope: fields.scope,
    isEnabled: fields.isEnabled,
    rolloutPercentage: fields.rolloutPercentage,
    ...(fields.tenantId !== null && { tenantId: fields.tenantId }),
  }
}

export const FeatureFlagsPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const queryClient = useQueryClient()
  const [isAdding, setIsAdding] = useState(false)

  const query = useQuery({
    queryKey: FEATURE_FLAGS_QUERY_KEY,
    queryFn: () => adminRequest<ListResponse>(`${FEATURE_FLAGS_PATH}?limit=${LIST_LIMIT}`).then((r) => r.data),
  })

  const upsertMutation = useMutation({
    mutationFn: (input: { readonly id?: string; readonly fields: UpsertFields }) => {
      const body = toUpsertBody(input.fields)
      return input.id === undefined
        ? adminRequest<ItemResponse>(FEATURE_FLAGS_PATH, jsonRequestInit('POST', body))
        : adminRequest<ItemResponse>(`${FEATURE_FLAGS_PATH}/${input.id}`, jsonRequestInit('PATCH', body))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY })
    },
  })

  function handleToggle(flag: FeatureFlagDto): void {
    upsertMutation.mutate({ id: flag.id, fields: { ...flag, isEnabled: !flag.isEnabled } })
  }

  function handleRolloutChange(flag: FeatureFlagDto, rolloutPercentage: number): void {
    upsertMutation.mutate({ id: flag.id, fields: { ...flag, rolloutPercentage } })
  }

  function handleCreate(fields: UpsertFields): void {
    upsertMutation.mutate({ fields })
    setIsAdding(false)
  }

  return (
    <section data-testid="feature-flags-page">
      <h1>{t('admin.feature_flags.title')}</h1>
      {query.isLoading ? <p role="status">{t('admin.feature_flags.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.feature_flags.error')}</p> : null}
      <table>
        <thead>
          <tr>
            <th>{t('admin.feature_flags.column.flag_key')}</th>
            <th>{t('admin.feature_flags.column.scope')}</th>
            <th>{t('admin.feature_flags.column.tenant')}</th>
            <th>{t('admin.feature_flags.column.enabled')}</th>
            <th>{t('admin.feature_flags.column.rollout')}</th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((flag) => (
            <FeatureFlagTableRow key={flag.id} flag={flag} onToggle={handleToggle} onRolloutChange={handleRolloutChange} t={t} />
          ))}
        </tbody>
      </table>
      {isAdding ? (
        <NewFeatureFlagForm onSubmit={handleCreate} onCancel={() => { setIsAdding(false) }} t={t} />
      ) : (
        <button type="button" onClick={() => { setIsAdding(true) }}>
          {t('admin.feature_flags.add_button')}
        </button>
      )}
    </section>
  )
}

interface FeatureFlagTableRowProps {
  readonly flag: FeatureFlagDto
  readonly onToggle: (flag: FeatureFlagDto) => void
  readonly onRolloutChange: (flag: FeatureFlagDto, rolloutPercentage: number) => void
  readonly t: TranslateFunction
}

const FeatureFlagTableRow = ({ flag, onToggle, onRolloutChange, t }: FeatureFlagTableRowProps): ReactElement => {
  const [rolloutDraft, setRolloutDraft] = useState(String(flag.rolloutPercentage))

  function commitRollout(): void {
    const parsed = Number(rolloutDraft)
    if (Number.isInteger(parsed) && parsed >= MIN_ROLLOUT_PERCENTAGE && parsed <= MAX_ROLLOUT_PERCENTAGE) {
      onRolloutChange(flag, parsed)
    } else {
      setRolloutDraft(String(flag.rolloutPercentage))
    }
  }

  return (
    <tr data-testid="feature-flag-row" data-flag-key={flag.flagKey}>
      <td>{flag.flagKey}</td>
      <td>{t(`admin.feature_flags.scope.${flag.scope}`)}</td>
      <td>{flag.tenantId ?? '—'}</td>
      <td>
        <input
          type="checkbox"
          role="switch"
          checked={flag.isEnabled}
          onChange={() => { onToggle(flag) }}
          style={{ accentColor: 'var(--brand-600)' }}
          aria-label={t('admin.feature_flags.column.enabled')}
        />
      </td>
      <td>
        <input
          type="number"
          min={MIN_ROLLOUT_PERCENTAGE}
          max={MAX_ROLLOUT_PERCENTAGE}
          value={rolloutDraft}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { setRolloutDraft(event.target.value) }}
          onBlur={commitRollout}
          aria-label={t('admin.feature_flags.column.rollout')}
        />
      </td>
    </tr>
  )
}

interface NewFeatureFlagFormProps {
  readonly onSubmit: (fields: UpsertFields) => void
  readonly onCancel: () => void
  readonly t: TranslateFunction
}

const NewFeatureFlagForm = ({ onSubmit, onCancel, t }: NewFeatureFlagFormProps): ReactElement => {
  const [flagKey, setFlagKey] = useState('')
  const [scope, setScope] = useState<FeatureFlagScope>('global')
  const [tenantId, setTenantId] = useState('')

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit({
      flagKey,
      scope,
      tenantId: scope === 'tenant' ? tenantId : null,
      isEnabled: false,
      rolloutPercentage: MAX_ROLLOUT_PERCENTAGE,
    })
  }

  return (
    <form onSubmit={handleSubmit} data-testid="new-feature-flag-form">
      <label>
        {t('admin.feature_flags.form.flag_key_label')}
        <input value={flagKey} onChange={(e: ChangeEvent<HTMLInputElement>) => { setFlagKey(e.target.value) }} required />
      </label>
      <label>
        {t('admin.feature_flags.form.scope_label')}
        <select value={scope} onChange={(e: ChangeEvent<HTMLSelectElement>) => { setScope(e.target.value as FeatureFlagScope) }}>
          {FEATURE_FLAG_SCOPE_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`admin.feature_flags.scope.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {scope === 'tenant' ? (
        <label>
          {t('admin.feature_flags.form.tenant_id_label')}
          <input value={tenantId} onChange={(e: ChangeEvent<HTMLInputElement>) => { setTenantId(e.target.value) }} required />
        </label>
      ) : null}
      <button type="submit">{t('admin.feature_flags.form.submit')}</button>
      <button type="button" onClick={onCancel}>
        {t('admin.feature_flags.form.cancel')}
      </button>
    </form>
  )
}
