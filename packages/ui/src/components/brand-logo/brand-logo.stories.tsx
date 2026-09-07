import type { Meta, StoryObj } from '@storybook/react-vite'
import { BrandLogo } from './brand-logo.js'

/** Единственное место кода, ссылающееся на «логотип бренда» без хардкода конкретного бренда
 * (`SRS-UX-010`) — `logoUrl` из `tenant.settings.brandLogoUrl` (`SRS-API-059`), `alt` уже
 * интерполирован потребителем через `useT()`. */
const meta: Meta<typeof BrandLogo> = {
  title: 'Components/BrandLogo',
  component: BrandLogo,
  args: {
    alt: 'Логотип аптечной сети',
  },
}

export default meta
type Story = StoryObj<typeof BrandLogo>

export const WithLogo: Story = {
  args: { logoUrl: 'https://placehold.co/120x40/png' },
}

export const FallbackNoUrl: Story = {
  args: { logoUrl: undefined },
}

export const FallbackBrokenUrl: Story = {
  args: { logoUrl: 'https://invalid.example/broken-logo.png' },
}
