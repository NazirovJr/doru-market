// Нет диалоговой библиотеки в проекте — действия строки открывают инлайн-режим, не модалку.
import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { STAFF_ROLE_VALUES, PLATFORM_ROLE_VALUES, USER_ROLES, type StaffRole, type PlatformRole, type UserSummaryDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useUsers, useUsersFilters, useDeactivateUser, useChangeStaffRole, useGrantPlatformRole } from '../api/use-users'

type RowAction = 'none' | 'deactivate' | 'change-role' | 'grant-role'

export const UsersPage = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const { filters, setFilter, resetFilters } = useUsersFilters()
  const [phoneDraft, setPhoneDraft] = useState(filters.phoneNumber ?? '')
  const [cursor, setCursor] = useState<string | null>(null)
  const [items, setItems] = useState<readonly UserSummaryDto[]>([])
  const [openAction, setOpenAction] = useState<{ readonly userId: string; readonly action: RowAction }>({ userId: '', action: 'none' })

  const query = useUsers(filters, cursor)

  useEffect(() => {
    setCursor(null)
    setItems([])
  }, [filters])

  useEffect(() => {
    if (query.data === undefined) return
    setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]))
  }, [query.data])

  function toggleAction(userId: string, action: RowAction): void {
    setOpenAction((prev) => (prev.userId === userId && prev.action === action ? { userId: '', action: 'none' } : { userId, action }))
  }

  function loadMore(): void {
    if (query.data?.nextCursor != null) {
      setCursor(query.data.nextCursor)
    }
  }

  return (
    <section data-testid="users-page">
      <h1>{t('admin.users.title')}</h1>
      <form
        data-testid="users-filters"
        onSubmit={(e) => {
          e.preventDefault()
          setFilter('phoneNumber', phoneDraft.trim() === '' ? undefined : phoneDraft.trim())
        }}
      >
        <label>
          {t('admin.users.filter.role')}
          <select
            value={filters.role ?? ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { setFilter('role', e.target.value === '' ? undefined : e.target.value) }}
          >
            <option value="">{t('admin.users.filter.role_all')}</option>
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`admin.users.role.${role}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.users.filter.phone_number')}
          <input value={phoneDraft} onChange={(e: ChangeEvent<HTMLInputElement>) => { setPhoneDraft(e.target.value) }} />
        </label>
        <label>
          {t('admin.users.filter.tenant_id')}
          <input
            value={filters.tenantId ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setFilter('tenantId', e.target.value.trim() === '' ? undefined : e.target.value.trim()) }}
          />
        </label>
        <button type="submit">{t('admin.users.filter.apply')}</button>
        <button
          type="button"
          onClick={() => {
            setPhoneDraft('')
            resetFilters()
          }}
        >
          {t('admin.users.filter.reset')}
        </button>
      </form>

      {query.isLoading ? <p role="status">{t('admin.users.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.users.error')}</p> : null}

      <table>
        <thead>
          <tr>
            <th>{t('admin.users.column.phone_number')}</th>
            <th>{t('admin.users.column.role')}</th>
            <th>{t('admin.users.column.tenant_id')}</th>
            <th>{t('admin.users.column.status')}</th>
            <th>{t('admin.users.column.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              openAction={openAction.userId === user.id ? openAction.action : 'none'}
              onToggleAction={(action) => { toggleAction(user.id, action) }}
              onDone={() => { setOpenAction({ userId: '', action: 'none' }) }}
            />
          ))}
        </tbody>
      </table>
      {!query.isLoading && items.length === 0 ? <p>{t('admin.users.empty')}</p> : null}
      {query.data?.hasMore === true ? (
        <button type="button" onClick={loadMore}>
          {t('admin.users.load_more')}
        </button>
      ) : null}
    </section>
  )
}

interface UserRowProps {
  readonly user: UserSummaryDto
  readonly openAction: RowAction
  readonly onToggleAction: (action: RowAction) => void
  readonly onDone: () => void
}

const UserRow = ({ user, openAction, onToggleAction, onDone }: UserRowProps): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  return (
    <>
      <tr data-testid="user-row">
        <td>{user.phoneNumber ?? '—'}</td>
        <td>{t(`admin.users.role.${user.role}`)}</td>
        <td>{user.tenantId}</td>
        <td>{user.isActive ? t('admin.users.status.active') : t('admin.users.status.inactive')}</td>
        <td>
          <button type="button" disabled={!user.isActive} onClick={() => { onToggleAction('deactivate') }}>
            {t('admin.users.action.deactivate')}
          </button>
          <button type="button" onClick={() => { onToggleAction('change-role') }}>
            {t('admin.users.action.change_role')}
          </button>
          <button type="button" onClick={() => { onToggleAction('grant-role') }}>
            {t('admin.users.action.grant_platform_role')}
          </button>
        </td>
      </tr>
      {openAction === 'deactivate' ? <DeactivateRow userId={user.id} onDone={onDone} /> : null}
      {openAction === 'change-role' ? <ChangeRoleRow userId={user.id} onDone={onDone} /> : null}
      {openAction === 'grant-role' ? <GrantPlatformRoleRow userId={user.id} onDone={onDone} /> : null}
    </>
  )
}

const DeactivateRow = ({ userId, onDone }: { readonly userId: string; readonly onDone: () => void }): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const mutation = useDeactivateUser()
  return (
    <tr data-testid="deactivate-confirm-row">
      <td colSpan={5}>
        <p>{t('admin.users.deactivate.confirm_prompt')}</p>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => { mutation.mutate(userId, { onSuccess: onDone }) }}
        >
          {t('admin.users.deactivate.confirm')}
        </button>
        {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
      </td>
    </tr>
  )
}

const ChangeRoleRow = ({ userId, onDone }: { readonly userId: string; readonly onDone: () => void }): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const mutation = useChangeStaffRole()
  const [role, setRole] = useState<StaffRole>(STAFF_ROLE_VALUES[0])
  return (
    <tr data-testid="change-role-row">
      <td colSpan={5}>
        <label>
          {t('admin.users.change_role.select_label')}
          <select value={role} onChange={(e: ChangeEvent<HTMLSelectElement>) => { setRole(e.target.value as StaffRole) }}>
            {STAFF_ROLE_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`admin.users.role.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => { mutation.mutate({ userId, newRole: role }, { onSuccess: onDone }) }}
        >
          {t('admin.users.change_role.submit')}
        </button>
        {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
      </td>
    </tr>
  )
}

const GRANT_REASON_MIN_LENGTH = 10

const GrantPlatformRoleRow = ({ userId, onDone }: { readonly userId: string; readonly onDone: () => void }): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const mutation = useGrantPlatformRole()
  const [role, setRole] = useState<PlatformRole>(PLATFORM_ROLE_VALUES[0])
  const [reason, setReason] = useState('')
  const reasonValid = reason.trim().length >= GRANT_REASON_MIN_LENGTH
  return (
    <tr data-testid="grant-platform-role-row">
      <td colSpan={5}>
        <p role="alert" data-testid="grant-platform-role-warning">
          {t('admin.users.grant_platform_role.warning')}
        </p>
        <label>
          {t('admin.users.grant_platform_role.select_label')}
          <select value={role} onChange={(e: ChangeEvent<HTMLSelectElement>) => { setRole(e.target.value as PlatformRole) }}>
            {PLATFORM_ROLE_VALUES.map((value) => (
              <option key={value} value={value}>
                {t(`admin.users.role.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('admin.users.grant_platform_role.reason_label')}
          <textarea value={reason} onChange={(e) => { setReason(e.target.value) }} required />
        </label>
        <button
          type="button"
          disabled={!reasonValid || mutation.isPending}
          onClick={() => { mutation.mutate({ userId, role, reason: reason.trim() }, { onSuccess: onDone }) }}
        >
          {t('admin.users.grant_platform_role.submit')}
        </button>
        {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
      </td>
    </tr>
  )
}
