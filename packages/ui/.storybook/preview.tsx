import type { Preview } from '@storybook/react-vite'
// DTJ-404 — подключение CSS-токенов (DTJ-401) для реального рендера цветов/отступов компонентов
// в Storybook: без этого var(--brand-*) не определены, и addon-a11y будет видеть невалидные цвета.
import '../src/tokens/index'

// Глобальные декораторы/параметры (токены темы, локаль) добавляются вместе с DTJ-401/402.
const preview: Preview = {
  parameters: {
    controls: { expanded: true },
  },
}

export default preview
