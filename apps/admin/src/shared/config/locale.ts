import type { Locale } from '@dorutj/i18n'

/**
 * `ADMIN_LOCALE` (DTJ-283) — `apps/admin` не имеет locale-провайдера/переключателя языка
 * (в отличие от `apps/web`, `shared/config/locale-provider.tsx`) — заведомо ВНЕ периметра этого
 * тикета (`features/support/**`, узкий `files_owned`). Зафиксирована `'ru'`: внутренний
 * персонал поддержки/платформы — предполагаемая рабочая аудитория `apps/admin` в R1. Единая
 * точка — при появлении реального выбора локали правится ОДИН этот файл, не каждый компонент.
 */
export const ADMIN_LOCALE: Locale = 'ru'
