import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileDropzone } from './file-dropzone.js'

/**
 * `FileDropzone` (`SRS-UX-021`, CUJ-5 фото рецепта + документы онбординга аптеки). Тексты в этих
 * историях — иллюстративные (RU-заглушки), в реальном приложении приходят из словарей `tj/ru/en`
 * через `useT()` у потребителя (`AGENTS.md` §9) — сам компонент строк не хранит.
 */
const meta: Meta<typeof FileDropzone> = {
  title: 'Components/FileDropzone',
  component: FileDropzone,
  args: {
    label: 'Перетащите фото рецепта сюда или выберите файл',
    browseButtonLabel: 'Выбрать файл',
    accept: 'image/*',
    maxSizeMb: 10,
    previewAltText: 'Превью загруженного фото рецепта',
    onFileAccepted: () => undefined,
  },
}

export default meta
type Story = StoryObj<typeof FileDropzone>

export const Idle: Story = {}

export const WithQualityChecklist: Story = {
  args: {
    qualityChecks: [
      { label: 'Хорошее освещение', passed: true },
      { label: 'Весь рецепт в кадре', passed: true },
      { label: 'Печать врача читаема', passed: false },
    ],
  },
}

export const TooLargeError: Story = {
  args: {
    error: 'Файл слишком большой — максимум 10 МБ',
  },
}

export const InvalidTypeError: Story = {
  args: {
    error: 'Неверный формат файла — разрешены только изображения',
  },
}

export const Uploading: Story = {
  args: {
    uploadProgress: 60,
    uploadProgressLabel: 'Загрузка файла — 60%',
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}
