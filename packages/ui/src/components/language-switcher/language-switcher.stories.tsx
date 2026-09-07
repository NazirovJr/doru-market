import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { Locale } from '@dorutj/i18n'
import { LanguageSwitcher } from './language-switcher.js'

/** Присутствует на КАЖДОМ неавторизованном экране (`SRS-UX-027`) — не принимает пропов
 * авторизации, рендерится идентично гостю и авторизованному пользователю. */
const meta: Meta<typeof LanguageSwitcher> = {
  title: 'Components/LanguageSwitcher',
  component: LanguageSwitcher,
  args: {
    currentLocale: 'tj',
    'aria-label': 'Язык интерфейса',
  },
}

export default meta
type Story = StoryObj<typeof LanguageSwitcher>

export const Interactive: Story = {
  render: (args) => {
    const InteractiveLanguageSwitcher = (): ReturnType<typeof LanguageSwitcher> => {
      const [locale, setLocale] = useState<Locale>(args.currentLocale)
      return <LanguageSwitcher {...args} currentLocale={locale} onChange={setLocale} />
    }
    return <InteractiveLanguageSwitcher />
  },
}

export const RussianActive: Story = { args: { currentLocale: 'ru', onChange: () => undefined } }

export const EnglishActive: Story = { args: { currentLocale: 'en', onChange: () => undefined } }
