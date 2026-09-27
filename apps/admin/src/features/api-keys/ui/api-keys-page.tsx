import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Badge, Button, Input, Select, Switch } from '@dorutj/ui'
import type { PharmacyAccountAdminSummaryDto, PharmacyApiKeyCreatedDto, PharmacyApiKeySummaryDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import {
  useCreatePharmacyApiKey,
  useOwnPharmacies,
  usePharmacyApiKeys,
  useRevokePharmacyApiKey,
  useRotatePharmacyApiKey,
  useSetPharmacyApiKeyMtls,
} from '../api/use-pharmacy-api-keys'
import { ApiKeyCreatedModal } from './api-key-created-modal'

function resolvePharmacyId(explicit: string | null, items: readonly PharmacyAccountAdminSummaryDto[]): string | null {
  return explicit ?? items[0]?.id ?? null
}

export const ApiKeysPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const pharmaciesQuery = useOwnPharmacies()
  const [pharmacyId, setPharmacyId] = useState<string | null>(null)
  const [created, setCreated] = useState<PharmacyApiKeyCreatedDto | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const items = pharmaciesQuery.data ?? []
  const selectedPharmacyId = resolvePharmacyId(pharmacyId, items)
  const keysQuery = usePharmacyApiKeys(selectedPharmacyId)

  return (
    <section data-testid="api-keys-page">
      <h1>{t('admin.api_keys.title')}</h1>

      <PharmacySelect items={items} value={selectedPharmacyId} onChange={setPharmacyId} />
      <CreateApiKeyButton pharmacyId={selectedPharmacyId} onCreated={setCreated} />

      {keysQuery.isLoading ? <p role="status">{t('admin.api_keys.loading')}</p> : null}
      {keysQuery.error !== null ? <p role="alert">{t('admin.api_keys.error')}</p> : null}

      <ApiKeysTable
        items={keysQuery.data ?? []}
        pharmacyId={selectedPharmacyId ?? ''}
        isLoading={keysQuery.isLoading}
        revokingId={revokingId}
        onToggleRevoke={setRevokingId}
        onRotated={setCreated}
      />

      <ApiKeyCreatedModal created={created} onClose={() => { setCreated(null) }} />
    </section>
  )
}

interface PharmacySelectProps {
  readonly items: readonly PharmacyAccountAdminSummaryDto[]
  readonly value: string | null
  readonly onChange: (value: string) => void
}

const PharmacySelect = ({ items, value, onChange }: PharmacySelectProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <Select
      label={t('admin.api_keys.pharmacy_select_label')}
      value={value}
      onChange={onChange}
      options={items.map((p) => ({ value: p.id, label: p.name }))}
    />
  )
}

interface CreateApiKeyButtonProps {
  readonly pharmacyId: string | null
  readonly onCreated: (created: PharmacyApiKeyCreatedDto) => void
}

const CreateApiKeyButton = ({ pharmacyId, onCreated }: CreateApiKeyButtonProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const createMutation = useCreatePharmacyApiKey(pharmacyId ?? '')

  return (
    <>
      <Button
        variant="primary"
        disabled={pharmacyId === null || createMutation.isPending}
        onClick={() => { createMutation.mutate(undefined, { onSuccess: onCreated }) }}
      >
        {t('admin.api_keys.action.create')}
      </Button>
      {createMutation.isError ? <p role="alert">{t('admin.api_keys.create.error')}</p> : null}
    </>
  )
}

const TABLE_COLUMN_COUNT = 6

interface ApiKeysTableProps {
  readonly items: readonly PharmacyApiKeySummaryDto[]
  readonly pharmacyId: string
  readonly isLoading: boolean
  readonly revokingId: string | null
  readonly onToggleRevoke: (keyId: string | null) => void
  readonly onRotated: (created: PharmacyApiKeyCreatedDto) => void
}

const ApiKeysTable = ({ items, pharmacyId, isLoading, revokingId, onToggleRevoke, onRotated }: ApiKeysTableProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>{t('admin.api_keys.column.key_prefix')}</th>
            <th>{t('admin.api_keys.column.status')}</th>
            <th>{t('admin.api_keys.column.mtls')}</th>
            <th>{t('admin.api_keys.column.last_used_at')}</th>
            <th>{t('admin.api_keys.column.created_at')}</th>
            <th>{t('admin.api_keys.column.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ApiKeyRow
              key={item.id}
              item={item}
              pharmacyId={pharmacyId}
              isRevoking={revokingId === item.id}
              onToggleRevoke={() => { onToggleRevoke(revokingId === item.id ? null : item.id) }}
              onDone={() => { onToggleRevoke(null) }}
              onRotated={onRotated}
            />
          ))}
        </tbody>
      </table>
      {!isLoading && items.length === 0 ? <p>{t('admin.api_keys.empty')}</p> : null}
    </>
  )
}

interface ApiKeyRowProps {
  readonly item: PharmacyApiKeySummaryDto
  readonly pharmacyId: string
  readonly isRevoking: boolean
  readonly onToggleRevoke: () => void
  readonly onDone: () => void
  readonly onRotated: (created: PharmacyApiKeyCreatedDto) => void
}

const ApiKeyRow = ({ item, pharmacyId, isRevoking, onToggleRevoke, onDone, onRotated }: ApiKeyRowProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const rotateMutation = useRotatePharmacyApiKey(pharmacyId)
  const mtlsMutation = useSetPharmacyApiKeyMtls(pharmacyId)

  return (
    <>
      <tr data-testid="api-key-row">
        <td>{item.keyPrefix}</td>
        <td>
          <Badge tone={item.isActive ? 'success' : 'neutral'}>
            {item.isActive ? t('admin.api_keys.status.active') : t('admin.api_keys.status.revoked')}
          </Badge>
        </td>
        <td>
          <Switch
            label={t('admin.api_keys.column.mtls')}
            checked={item.requireMtls}
            disabled={!item.isActive || mtlsMutation.isPending}
            onChange={(checked) => { mtlsMutation.mutate({ keyId: item.id, requireMtls: checked }) }}
          />
        </td>
        <td>{item.lastUsedAt ?? '—'}</td>
        <td>{item.createdAt}</td>
        <td>
          <Button
            variant="secondary"
            disabled={!item.isActive || rotateMutation.isPending}
            onClick={() => { rotateMutation.mutate(item.id, { onSuccess: onRotated }) }}
          >
            {t('admin.api_keys.action.rotate')}
          </Button>
          <Button variant="danger" disabled={!item.isActive} onClick={onToggleRevoke}>
            {t('admin.api_keys.action.revoke')}
          </Button>
        </td>
      </tr>
      {rotateMutation.isError ? (
        <tr>
          <td colSpan={TABLE_COLUMN_COUNT}>
            <p role="alert">{t('admin.api_keys.rotate.error')}</p>
          </td>
        </tr>
      ) : null}
      {isRevoking ? <RevokeConfirmRow keyId={item.id} pharmacyId={pharmacyId} onDone={onDone} /> : null}
    </>
  )
}

interface RevokeConfirmRowProps {
  readonly keyId: string
  readonly pharmacyId: string
  readonly onDone: () => void
}

const RevokeConfirmRow = ({ keyId, pharmacyId, onDone }: RevokeConfirmRowProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const revokeMutation = useRevokePharmacyApiKey(pharmacyId)
  const [reason, setReason] = useState('')

  return (
    <tr data-testid="revoke-confirm-row">
      <td colSpan={TABLE_COLUMN_COUNT}>
        <Input label={t('admin.api_keys.revoke.reason_label')} value={reason} onChange={(e) => { setReason(e.target.value) }} />
        <Button
          variant="danger"
          disabled={reason.trim().length === 0 || revokeMutation.isPending}
          onClick={() => { revokeMutation.mutate({ keyId, reason: reason.trim() }, { onSuccess: onDone }) }}
        >
          {t('admin.api_keys.revoke.confirm')}
        </Button>
        {revokeMutation.isError ? <p role="alert">{t('admin.api_keys.revoke.error')}</p> : null}
      </td>
    </tr>
  )
}
