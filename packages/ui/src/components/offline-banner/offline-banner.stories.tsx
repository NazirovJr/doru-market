import type { Meta, StoryObj } from '@storybook/react-vite'
import { useT } from '@dorutj/i18n'
import { OfflineBanner } from './offline-banner.js'

/** ЕДИНЫЙ компонент для всех контекстов офлайна (DTJ-406 п.5) — текст всегда
 * `ux.error.network_offline`, никогда не закрывается пользователем (AC1). */
const meta: Meta<typeof OfflineBanner> = {
  title: 'Components/OfflineBanner',
  component: OfflineBanner,
}

export default meta
type Story = StoryObj<typeof OfflineBanner>

const { t } = useT('ru')

export const Fullscreen: Story = { args: { t, isOnline: false, compact: false } }

export const Compact: Story = { args: { t, isOnline: false, compact: true } }

export const Online: Story = { args: { t, isOnline: true } }
