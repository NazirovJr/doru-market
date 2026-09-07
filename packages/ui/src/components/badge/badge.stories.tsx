import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './badge.js'

/** `tone` — чисто визуальная семантика, доменный enum → `tone` маппит потребитель (`SRS-UX-021`).
 * Текст обязателен пропсом `children` — статус никогда не передаётся только цветом. */
const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  args: {
    children: 'Доставлено',
    tone: 'success',
  },
}

export default meta
type Story = StoryObj<typeof Badge>

export const Success: Story = {}

export const Danger: Story = { args: { tone: 'danger', children: 'Отменён' } }

export const Warning: Story = { args: { tone: 'warning', children: 'Истекает срок' } }

export const Neutral: Story = { args: { tone: 'neutral', children: 'Черновик' } }
