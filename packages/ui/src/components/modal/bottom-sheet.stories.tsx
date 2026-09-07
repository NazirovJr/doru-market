import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../button/button.js'
import { BottomSheet } from './bottom-sheet.js'

/** Мобильный оверлей снизу (`viewport < 768px`, `SRS-UX-021`) — тот же контракт пропсов, что и
 * `Modal`, плюс свайп вниз по "ручке" для закрытия (DTJ-406 п.2). */
const meta: Meta<typeof BottomSheet> = {
  title: 'Components/BottomSheet',
  component: BottomSheet,
}

export default meta
type Story = StoryObj<typeof BottomSheet>

const BottomSheetDemo = () => {
  const [isOpen, setIsOpen] = useState(true)
  return (
    <>
      <Button
        onClick={() => {
          setIsOpen(true)
        }}
      >
        Открыть шторку
      </Button>
      <BottomSheet
        isOpen={isOpen}
        onClose={() => {
          setIsOpen(false)
        }}
        title="Аптеки рядом"
        closeButtonLabel="Закрыть"
      >
        <p>Список аптек в выбранной области карты.</p>
      </BottomSheet>
    </>
  )
}

export const Default: Story = { render: () => <BottomSheetDemo /> }
