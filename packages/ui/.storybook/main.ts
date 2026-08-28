import type { StorybookConfig } from '@storybook/react-vite'

// Storybook 9 на Vite-билдере (DTJ-400). @storybook/addon-a11y подключён по умолчанию —
// переиспользуется тикетом DTJ-403 для автоматических axe-прогонов историй (SRS-UX-021).
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
}

export default config
