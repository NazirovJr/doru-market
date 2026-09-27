// Нет диалоговой библиотеки в проекте — инлайн-режимы строк, не модалки (тот же приём, что users-page.tsx).
import { useEffect, useState, type ChangeEvent, type ReactElement, type SubmitEvent } from 'react'
import { useT } from '@dorutj/i18n'
import { STAFF_ACCOUNT_ROLE_VALUES, type StaffAccountRole, type StaffAccountSummaryDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { getCurrentChainId } from '@/shared/auth/current-role'
import {
  useStaffAccounts,
  useDeactivateStaffAccount,
  useCreateStaffAccount,
  useProvisionCourierRetry,
  StaffAccountCreatePartialError,
} from '../api/use-staff-accounts'

const PHONE_PREFIX = '+992'
const PHONE_DIGITS_REQUIRED = 9

function toE164(digits: string): string {
  return `${PHONE_PREFIX}${digits.replace(/\D/g, '').slice(0, PHONE_DIGITS_REQUIRED)}`
}

export const StaffAccountsPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [chainId] = useState<string | null>(() => getCurrentChainId())
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly StaffAccountSummaryDto[]>([])
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)

  const query = useStaffAccounts(cursor)

  useEffect(() => {
    if (query.data === undefined) return
    setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]))
  }, [query.data])

  function loadMore(): void {
    if (query.data?.nextCursor != null) {
      setCursor(query.data.nextCursor)
    }
  }

  return (
    <section data-testid="staff-accounts-page">
      <h1>{t('admin.staff.title')}</h1>

      <CreateStaffAccountForm chainId={chainId} />

      {query.isLoading ? <p role="status">{t('admin.staff.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.staff.error')}</p> : null}

      <table>
        <thead>
          <tr>
            <th>{t('admin.staff.column.full_name')}</th>
            <th>{t('admin.staff.column.phone_number')}</th>
            <th>{t('admin.staff.column.role')}</th>
            <th>{t('admin.staff.column.pharmacy')}</th>
            <th>{t('admin.staff.column.status')}</th>
            <th>{t('admin.staff.column.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <StaffAccountRow
              key={item.id}
              item={item}
              isDeactivating={deactivatingId === item.id}
              onToggleDeactivate={() => { setDeactivatingId((prev) => (prev === item.id ? null : item.id)) }}
              onDone={() => { setDeactivatingId(null) }}
            />
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.staff.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.staff.load_more')}
        </button>
      ) : null}
    </section>
  )
}

interface StaffAccountRowProps {
  readonly item: StaffAccountSummaryDto
  readonly isDeactivating: boolean
  readonly onToggleDeactivate: () => void
  readonly onDone: () => void
}

const StaffAccountRow = ({ item, isDeactivating, onToggleDeactivate, onDone }: StaffAccountRowProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const deactivateMutation = useDeactivateStaffAccount()
  const retryMutation = useProvisionCourierRetry()

  return (
    <>
      <tr data-testid="staff-account-row">
        <td>{item.fullName ?? '—'}</td>
        <td>{item.phoneNumber ?? '—'}</td>
        <td>{t(`admin.staff.role.${item.role}`)}</td>
        <td>{item.pharmacyId ?? '—'}</td>
        <td>{item.isActive ? t('admin.staff.status.active') : t('admin.staff.status.inactive')}</td>
        <td>
          <button type="button" disabled={!item.isActive} onClick={onToggleDeactivate}>
            {t('admin.staff.action.deactivate')}
          </button>
          {item.role === 'courier' && item.courierProvisioned === false ? (
            <button type="button" disabled={retryMutation.isPending} onClick={() => { retryMutation.mutate(item.id) }}>
              {t('admin.staff.action.retry_provision_courier')}
            </button>
          ) : null}
        </td>
      </tr>
      {isDeactivating ? (
        <tr data-testid="deactivate-confirm-row">
          <td colSpan={6}>
            <p>{t('admin.staff.deactivate.confirm_prompt')}</p>
            <button
              type="button"
              disabled={deactivateMutation.isPending}
              onClick={() => { deactivateMutation.mutate(item.id, { onSuccess: onDone }) }}
            >
              {t('admin.staff.deactivate.confirm')}
            </button>
            {deactivateMutation.isError ? <p role="alert">{deactivateMutation.error.message}</p> : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}

const CreateStaffAccountForm = ({ chainId }: { readonly chainId: string | null }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const mutation = useCreateStaffAccount()
  const [digits, setDigits] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<StaffAccountRole>(STAFF_ACCOUNT_ROLE_VALUES[0])
  const [pharmacyId, setPharmacyId] = useState('')

  const isValid = digits.length === PHONE_DIGITS_REQUIRED && fullName.trim().length > 0 && chainId !== null

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!isValid) return
    mutation.mutate(
      {
        phone: toE164(digits),
        fullName: fullName.trim(),
        role,
        chainId,
        ...(role === 'pharmacist' && pharmacyId.trim() !== '' ? { pharmacyId: pharmacyId.trim() } : {}),
      },
      {
        onSuccess: () => {
          setDigits('')
          setFullName('')
          setPharmacyId('')
        },
      },
    )
  }

  return (
    <form data-testid="create-staff-account-form" onSubmit={handleSubmit}>
      <label>
        {t('admin.staff.create.phone_label')}
        <span>{PHONE_PREFIX}</span>
        <input
          inputMode="numeric"
          value={digits}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setDigits(e.target.value.replace(/\D/g, '').slice(0, PHONE_DIGITS_REQUIRED)) }}
        />
      </label>
      <label>
        {t('admin.staff.create.full_name_label')}
        <input value={fullName} onChange={(e: ChangeEvent<HTMLInputElement>) => { setFullName(e.target.value) }} />
      </label>
      <label>
        {t('admin.staff.create.role_label')}
        <select value={role} onChange={(e: ChangeEvent<HTMLSelectElement>) => { setRole(e.target.value as StaffAccountRole) }}>
          {STAFF_ACCOUNT_ROLE_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`admin.staff.role.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {role === 'pharmacist' ? (
        <label>
          {t('admin.staff.create.pharmacy_label')}
          <input value={pharmacyId} onChange={(e: ChangeEvent<HTMLInputElement>) => { setPharmacyId(e.target.value) }} />
        </label>
      ) : null}
      <button type="submit" disabled={!isValid || mutation.isPending}>
        {t('admin.staff.create.submit')}
      </button>
      {mutation.isError ? (
        <p role="alert">
          {mutation.error instanceof StaffAccountCreatePartialError
            ? t('admin.staff.create.partial_error')
            : t('admin.staff.create.error')}
        </p>
      ) : null}
    </form>
  )
}
