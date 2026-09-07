import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../button/button.js'
import { Modal } from './modal.js'

/** Десктопный оверлей по центру (`SRS-UX-021`). Фокус-ловушка/Escape/клик вне контента — DTJ-406
 * п.2, `useFocusTrap` подключён внутри компонента. */
const meta: Meta<typeof Modal> = {
  title: 'Components/Modal',
  component: Modal,
}

export default meta
type Story = StoryObj<typeof Modal>

const ModalDemo = () => {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <>
      <Button
        onClick={() => {
          setIsOpen(true)
        }}
      >
        Открыть модалку
      </Button>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false)
        }}
        title="Отменить заказ?"
        closeButtonLabel="Закрыть"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setIsOpen(false)
              }}
            >
              Отменить заказ
            </Button>
          </>
        }
      >
        <p>Заказ №4821 будет отменён, деньги вернутся на счёт в течение 3 рабочих дней.</p>
      </Modal>
    </>
  )
}

export const Default: Story = { render: () => <ModalDemo /> }
