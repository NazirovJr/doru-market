import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Tabs, type TabItem } from './tabs.js'

const SORT_ITEMS: readonly TabItem[] = [
  { id: 'relevance', label: 'По релевантности' },
  { id: 'price_asc', label: 'Сначала дешевле' },
  { id: 'distance', label: 'Ближе всего' },
]

/** `Tabs` реализует сортировку результатов поиска как пилюли (не `Select`, расхождение
 * `32-design-reference.md`), «Новые»/«В сборке» терминала аптеки, переключатель периода
 * аналитики — список вкладок домен-агностичен. */
const meta: Meta<typeof Tabs> = {
  title: 'Components/Tabs',
  component: Tabs,
  args: {
    items: SORT_ITEMS,
    value: 'relevance',
    onChange: () => undefined,
    'aria-label': 'Сортировка результатов поиска',
  },
}

export default meta
type Story = StoryObj<typeof Tabs>

export const Interactive: Story = {
  render: (args) => {
    const InteractiveTabs = (): ReturnType<typeof Tabs> => {
      const [value, setValue] = useState(args.value)
      return <Tabs {...args} value={value} onChange={setValue} />
    }
    return <InteractiveTabs />
  },
}

export const WithDisabledTab: Story = {
  args: {
    items: [
      { id: 'new', label: 'Новые' },
      { id: 'assembling', label: 'В сборке' },
      { id: 'archived', label: 'Архив', disabled: true },
    ],
    value: 'new',
  },
}
