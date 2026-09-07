import type { Meta, StoryObj } from '@storybook/react-vite'
import { useT } from '@dorutj/i18n'
import { EmptyState } from './empty-state.js'

/** Текст — ТОЛЬКО ключи `ux.empty.*` словаря `@dorutj/i18n` (§5 `30-ux-screens-and-flows.md`),
 * `t` — результат `useT()` потребителя (DTJ-406). */
const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
}

export default meta
type Story = StoryObj<typeof EmptyState>

const { t } = useT('ru')

/** Демо-обработчик CTA — в реальном приложении переход к поиску, здесь только показывает, что
 * CTA кликабелен (Storybook-история не подключена к роутеру). */
function handleDemoCtaClick(): void {
  window.alert('CTA нажата (демо Storybook)')
}

export const CartEmpty: Story = {
  args: { t, titleKey: 'ux.empty.cart', ctaLabelKey: 'cart.empty_cta', onCtaClick: handleDemoCtaClick },
}

export const SearchNoResults: Story = {
  args: { t, titleKey: 'ux.empty.search_no_results' },
}

export const OrdersEmpty: Story = {
  args: { t, titleKey: 'ux.empty.orders' },
}

export const OrderQueueEmpty: Story = {
  args: { t, titleKey: 'ux.empty.order_queue' },
}
