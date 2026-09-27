// DTJ-365: ЕДИНСТВЕННОЕ место, где apiKey/hmacSecret видны целиком (SRS-ADM-043) — закрывается
// ТОЛЬКО явным действием пользователя, без автозакрытия таймером (в отличие от Toast).
import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, Modal } from '@dorutj/ui'
import type { PharmacyApiKeyCreatedDto } from '@dorutj/contracts'
import { ADMIN_LOCALE } from '@/shared/config/locale'

export interface ApiKeyCreatedModalProps {
  readonly created: PharmacyApiKeyCreatedDto | null
  readonly onClose: () => void
}

export const ApiKeyCreatedModal = ({ created, onClose }: ApiKeyCreatedModalProps): ReactElement | null => {
  const { t } = useT(ADMIN_LOCALE)
  const [copied, setCopied] = useState<'apiKey' | 'hmacSecret' | null>(null)

  if (created === null) return null

  function copy(field: 'apiKey' | 'hmacSecret', value: string): void {
    void navigator.clipboard.writeText(value).then(() => { setCopied(field) })
  }

  return (
    <Modal isOpen title={t('admin.api_keys.created_modal.title')} closeButtonLabel={t('common.close')} onClose={onClose}>
      <p role="alert">{t('admin.api_keys.created_modal.warning')}</p>
      <dl>
        <dt>{t('admin.api_keys.created_modal.api_key_label')}</dt>
        <dd>
          <code data-testid="created-api-key-value">{created.apiKey}</code>
          <Button variant="secondary" onClick={() => { copy('apiKey', created.apiKey) }}>
            {copied === 'apiKey' ? t('admin.api_keys.created_modal.copied') : t('admin.api_keys.created_modal.copy')}
          </Button>
        </dd>
        <dt>{t('admin.api_keys.created_modal.hmac_secret_label')}</dt>
        <dd>
          <code data-testid="created-hmac-secret-value">{created.hmacSecret}</code>
          <Button variant="secondary" onClick={() => { copy('hmacSecret', created.hmacSecret) }}>
            {copied === 'hmacSecret' ? t('admin.api_keys.created_modal.copied') : t('admin.api_keys.created_modal.copy')}
          </Button>
        </dd>
      </dl>
      <Button variant="primary" onClick={onClose} data-testid="created-modal-confirm-close">
        {t('admin.api_keys.created_modal.confirm_close')}
      </Button>
    </Modal>
  )
}
