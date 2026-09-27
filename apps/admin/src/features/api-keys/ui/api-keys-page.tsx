// Кабинет pharmacy_admin — CRUD ключей 1С своей аптеки; маршрут плоский, поэтому аптека выбирается Select'ом.
import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Badge, Button, Input, Select } from '@dorutj/ui'
import type { PharmacyAccountAdminSummaryDto, PharmacyApiKeyCreatedDto, PharmacyApiKeySummaryDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useCreatePharmacyApiKey, useOwnPharmacies, usePharmacyApiKeys, useRevokePharmacyApiKey } from '../api/use-pharmacy-api-keys'
import { ApiKeyCreatedModal } from './api-key-created-modal'

function resolvePharmacyId(explicit: string | null, items: readonly PharmacyAccountAdminSummaryDto[]): string | null {
  return explicit ?? items[0]?.id ?? null
}

export const ApiKeysPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
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
  const { t } = useT(ADMIN_LOCALE)
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
  const { t } = useT(ADMIN_LOCALE)
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

interface ApiKeysTableProps {
  readonly items: readonly PharmacyApiKeySummaryDto[]
  readonly pharmacyId: string
  readonly isLoading: boolean
  readonly revokingId: string | null
  readonly onToggleRevoke: (keyId: string | null) => void
}

const ApiKeysTable = ({ items, pharmacyId, isLoading, revokingId, onToggleRevoke }: ApiKeysTableProps): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>{t('admin.api_keys.column.key_prefix')}</th>
            <th>{t('admin.api_keys.column.status')}</th>
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
}

const ApiKeyRow = ({ item, pharmacyId, isRevoking, onToggleRevoke, onDone }: ApiKeyRowProps): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const revokeMutation = useRevokePharmacyApiKey(pharmacyId)
  const [reason, setReason] = useState('')

  return (
    <>
      <tr data-testid="api-key-row">
        <td>{item.keyPrefix}</td>
        <td>
          <Badge tone={item.isActive ? 'success' : 'neutral'}>
            {item.isActive ? t('admin.api_keys.status.active') : t('admin.api_keys.status.revoked')}
          </Badge>
        </td>
        <td>{item.createdAt}</td>
        <td>
          <Button variant="danger" disabled={!item.isActive} onClick={onToggleRevoke}>
            {t('admin.api_keys.action.revoke')}
          </Button>
        </td>
      </tr>
      {isRevoking ? (
        <tr data-testid="revoke-confirm-row">
          <td colSpan={4}>
            <Input
              label={t('admin.api_keys.revoke.reason_label')}
              value={reason}
              onChange={(e) => { setReason(e.target.value) }}
            />
            <Button
              variant="danger"
              disabled={reason.trim().length === 0 || revokeMutation.isPending}
              onClick={() => {
                revokeMutation.mutate({ keyId: item.id, reason: reason.trim() }, { onSuccess: onDone })
              }}
            >
              {t('admin.api_keys.revoke.confirm')}
            </Button>
            {revokeMutation.isError ? <p role="alert">{t('admin.api_keys.revoke.error')}</p> : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}
