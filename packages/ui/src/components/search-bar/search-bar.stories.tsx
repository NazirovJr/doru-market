import type { Meta, StoryObj } from '@storybook/react-vite'
import { SearchBar } from './search-bar.js'

/** Точка входа CUJ-1 (`SRS-UX-009`). Голосовая иконка — опциональный проп `onVoiceInput`
 * (`[R1·флаг]`), по умолчанию не рендерится. */
const meta: Meta<typeof SearchBar> = {
  title: 'Components/SearchBar',
  component: SearchBar,
  args: {
    label: 'Поиск лекарства',
    placeholder: 'Название препарата',
    onSearch: () => undefined,
  },
}

export default meta
type Story = StoryObj<typeof SearchBar>

export const Default: Story = {}

export const WithVoiceInput: Story = {
  args: {
    onVoiceInput: () => undefined,
    voiceInputAriaLabel: 'Голосовой поиск',
  },
}
