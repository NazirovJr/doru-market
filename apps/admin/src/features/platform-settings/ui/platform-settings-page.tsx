// READ-ONLY экран, без форм/мутаций. Badge — построчная пометка (не общий баннер): список может расти новыми не-ENV ключами.
import { type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@dorutj/i18n'
import { Badge } from '@dorutj/ui'
import type { PlatformSettingDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { adminRequest } from '@/shared/api/admin-client'

const PLATFORM_SETTINGS_PATH = '/platform-settings'
const PLATFORM_SETTINGS_QUERY_KEY = ['admin', 'platform-settings', 'list'] as const

interface ListResponse {
  readonly data: readonly PlatformSettingDto[]
}

export const PlatformSettingsPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)

  const query = useQuery({
    queryKey: PLATFORM_SETTINGS_QUERY_KEY,
    queryFn: () => adminRequest<ListResponse>(PLATFORM_SETTINGS_PATH).then((r) => r.data),
  })

  return (
    <section data-testid="platform-settings-page">
      <h1>{t('admin.platform_settings.title')}</h1>
      <p>{t('admin.platform_settings.description')}</p>
      {query.isLoading ? <p role="status">{t('admin.platform_settings.loading')}</p> : null}
      {query.error !== null ? <p role="alert">{t('admin.platform_settings.error')}</p> : null}
      <table>
        <thead>
          <tr>
            <th>{t('admin.platform_settings.column.key')}</th>
            <th>{t('admin.platform_settings.column.value')}</th>
            <th>{t('admin.platform_settings.column.description')}</th>
            <th>{t('admin.platform_settings.column.redeploy')}</th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((setting) => (
            <tr key={setting.key} data-testid="platform-settings-row">
              <td>
                <code>{setting.key}</code>
              </td>
              <td>{setting.currentValue}</td>
              <td>{t(setting.descriptionKey)}</td>
              <td data-testid="platform-settings-redeploy-badge">
                <Badge tone="warning">{t('admin.platform_settings.requires_redeploy')}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
