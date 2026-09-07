import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Input } from './input.js'

/** `label`↔`input` через `htmlFor`/`id`, `error`-слот — иконка + текст под полем (`SRS-UX-019`). */
const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  args: {
    label: 'Номер телефона',
    placeholder: '+992 XX XXX XX XX',
  },
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {
  render: (args) => {
    const ControlledInput = (): ReturnType<typeof Input> => {
      const [value, setValue] = useState('')
      return (
        <Input
          {...args}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
        />
      )
    }
    return <ControlledInput />
  },
}

export const WithError: Story = {
  args: { error: 'Обязательное поле', value: '' },
}

export const Disabled: Story = {
  args: { disabled: true, value: '' },
}
