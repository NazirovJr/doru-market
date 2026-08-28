import type { Preview } from '@storybook/react-vite'

// Глобальные декораторы/параметры (токены темы, локаль) добавляются вместе с DTJ-401/402.
const preview: Preview = {
  parameters: {
    controls: { expanded: true },
  },
}

export default preview
