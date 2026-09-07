import type { Meta, StoryObj } from '@storybook/react-vite'
import { AudioAlertPlayer } from './audio-alert-player.js'

/**
 * `AudioAlertPlayer` (`SRS-UX-007`, двойной канал критичных событий терминала аптеки). Storybook
 * рендерит только визуальный канал (реальный звук требует `AudioContext` + `unlock()` жестом,
 * см. `useAudioAlertPlayer()` — используйте хук в реальном экране, не в этой истории).
 *
 * ПРОБЕЛ ТРЕБОВАНИЙ (см. «Риски» DTJ-410): конкретный звуковой файл сигнала НЕ специфицирован ни
 * в одном SRS-документе. Здесь используется placeholder-тон (`AudioContext.createOscillator()`),
 * не внешний аудио-ассет. Финальный звук — доработка EP-12 (веб-кабинет аптеки), первого реального
 * потребителя компонента.
 */
const meta: Meta<typeof AudioAlertPlayer> = {
  title: 'Components/AudioAlertPlayer',
  component: AudioAlertPlayer,
  args: {
    label: 'Новый заказ — требуется сборка',
    audioContext: null,
  },
}

export default meta
type Story = StoryObj<typeof AudioAlertPlayer>

export const Active: Story = {
  args: {
    trigger: { soundKey: 'new_order', nonce: 1 },
  },
}

export const Inactive: Story = {
  args: {
    trigger: null,
  },
}
