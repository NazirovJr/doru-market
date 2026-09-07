import type { Meta, StoryObj } from '@storybook/react-vite'
import { ProgressBar } from './progress-bar.js'

/** Базовая генерическая версия 0–100% (`SRS-UX-021`) — `label` уже переведённый текст (вызывающий
 * код прогоняет свой `labelKey` через `useT()` заранее). Агрегирующий Excel-вариант — вне тикета,
 * реализуется обёрткой над этим компонентом. */
const meta: Meta<typeof ProgressBar> = {
  title: 'Components/ProgressBar',
  component: ProgressBar,
}

export default meta
type Story = StoryObj<typeof ProgressBar>

export const Default: Story = { args: { value: 40 } }

export const WithLabel: Story = { args: { value: 65, label: 'Импорт остатков: батч 2 из 5' } }

export const Complete: Story = { args: { value: 100, label: 'Готово' } }

export const Empty: Story = { args: { value: 0, label: 'Ожидание запуска' } }
