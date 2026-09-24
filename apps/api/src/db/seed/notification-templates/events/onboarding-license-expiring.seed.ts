/** Шаблоны `onboarding.license_expiring` (SRS-ADM-052, `LicenseExpiringSoonEvent`, получатель — `pharmacy_admin`). Каналы: telegram → sms (daysRemaining<=3) → web_push + in_app. */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ONBOARDING_LICENSE_EXPIRING_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] =
  buildNotificationTemplateRows(
    'onboarding.license_expiring',
    { required: ['brandName', 'pharmacyName', 'daysRemaining', 'licenseExpiryDate'] },
    [
      {
        channel: 'telegram',
        body: {
          ru: '{{brandName}}: лицензия аптеки «{{pharmacyName}}» истекает через {{daysRemaining}} дн. ({{licenseExpiryDate}}). Продлите её заранее.',
          tj: '{{brandName}}: иҷозатномаи дорухонаи «{{pharmacyName}}» пас аз {{daysRemaining}} рӯз ({{licenseExpiryDate}}) ба анҷом мерасад. Пешакӣ дароз кунед.',
          en: '{{brandName}}: license of pharmacy "{{pharmacyName}}" expires in {{daysRemaining}} day(s) ({{licenseExpiryDate}}). Renew it in advance.',
        },
      },
      {
        channel: 'sms',
        body: {
          ru: '{{brandName}}: лицензия «{{pharmacyName}}» истекает через {{daysRemaining}} дн.',
          tj: '{{brandName}}: иҷозатномаи «{{pharmacyName}}» пас аз {{daysRemaining}} рӯз анҷом меёбад.',
          en: '{{brandName}}: license of "{{pharmacyName}}" expires in {{daysRemaining}} day(s).',
        },
      },
      {
        channel: 'web_push',
        subject: { ru: 'Лицензия скоро истекает', tj: 'Иҷозатнома ба зудӣ анҷом меёбад', en: 'License expiring soon' },
        body: {
          ru: '«{{pharmacyName}}»: осталось {{daysRemaining}} дн. ({{licenseExpiryDate}}).',
          tj: '«{{pharmacyName}}»: {{daysRemaining}} рӯз монд ({{licenseExpiryDate}}).',
          en: '"{{pharmacyName}}": {{daysRemaining}} day(s) left ({{licenseExpiryDate}}).',
        },
      },
      {
        channel: 'in_app',
        body: {
          ru: 'Лицензия «{{pharmacyName}}» истекает {{licenseExpiryDate}} (осталось {{daysRemaining}} дн.).',
          tj: 'Иҷозатномаи «{{pharmacyName}}» дар {{licenseExpiryDate}} анҷом меёбад ({{daysRemaining}} рӯз монд).',
          en: 'License of "{{pharmacyName}}" expires on {{licenseExpiryDate}} ({{daysRemaining}} day(s) left).',
        },
      },
    ],
  )
