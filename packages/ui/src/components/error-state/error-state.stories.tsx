import type { Meta, StoryObj } from '@storybook/react-vite'
import { useT } from '@dorutj/i18n'
import { ErrorState } from './error-state.js'

/** Пользователь видит ТОЛЬКО дружелюбный текст — код ошибки/`requestId` скрыты в `<details>`
 * (DoD DTJ-406). */
const meta: Meta<typeof ErrorState> = {
  title: 'Components/ErrorState',
  component: ErrorState,
}

export default meta
type Story = StoryObj<typeof ErrorState>

const { t } = useT('ru')

/** Демо-обработчик повтора — Storybook-история не подключена к реальному запросу. */
function handleDemoRetry(): void {
  window.alert('Повтор запроса (демо Storybook)')
}

export const Fullscreen: Story = {
  args: { t, variant: 'fullscreen', onRetry: handleDemoRetry, errorCode: '500', requestId: 'req-8a21f' },
}

export const Inline: Story = {
  args: { t, variant: 'inline', descriptionKey: 'ux.error.search_timeout', onRetry: handleDemoRetry },
}

export const WithoutRetry: Story = {
  args: { t, variant: 'inline', descriptionKey: 'ux.error.pharmacy_unavailable' },
}
