import type { Meta, StoryFn, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { Button } from '../button/button.js'
import { ToastProvider } from './toast.js'
import { useToast } from './use-toast.js'

function renderStoryInToastProvider(story: StoryFn): ReactElement {
  return (
    <ToastProvider>
      {story()}
    </ToastProvider>
  )
}

/** `useToast()` — императивный вызов, без проп-дрилинга (DTJ-406 п.1). Каждая история оборачивает
 * демо-кнопку в `<ToastProvider>` — в реальном приложении провайдер подключается ОДИН РАЗ в корне
 * `apps/*`, здесь дублируется на историю только ради изолированной демонстрации в Storybook. */
const meta: Meta = {
  title: 'Components/Toast',
  decorators: [renderStoryInToastProvider],
}

export default meta
type Story = StoryObj

const SuccessDemo = () => {
  const toast = useToast()
  return <Button onClick={() => toast.success('Заказ оформлен')}>Показать success-тост (4с)</Button>
}

export const Success: Story = { render: () => <SuccessDemo /> }

const ErrorDemo = () => {
  const toast = useToast()
  return <Button variant="danger" onClick={() => toast.error('Не удалось оформить заказ')}>Показать error-тост</Button>
}

export const ErrorVariant: Story = { render: () => <ErrorDemo /> }

const PersistentDemo = () => {
  const toast = useToast()
  return (
    <Button
      variant="danger"
      onClick={() => toast.error('Заказ отменён по таймауту SLA', { persistent: true })}
    >
      Показать persistent-тост (не закрывается автоматически)
    </Button>
  )
}

export const Persistent: Story = { render: () => <PersistentDemo /> }

const StackDemo = () => {
  const toast = useToast()
  return (
    <Button
      onClick={() => {
        toast.success('Первый тост')
        toast.info('Второй тост')
        toast.warning('Третий тост')
      }}
    >
      Показать несколько тостов подряд
    </Button>
  )
}

export const Stack: Story = { render: () => <StackDemo /> }
